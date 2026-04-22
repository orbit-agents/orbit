//! Claude Code CLI engine.
//!
//! Milestone 2 / Phase 1a: this is a stub that emits scripted events so
//! the frontend can be built against the real trait surface before the
//! subprocess code lands. Milestone 5 replaces the internals of
//! `send_message` and `spawn` with real `tokio::process::Command` + the
//! stream-json parser; the public API on this type does not change.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use futures::stream::BoxStream;
use futures::StreamExt;
use tokio::sync::Mutex;

use super::engine::{
    AgentEngine, AgentEvent, AgentId, EngineError, EngineHealth, SpawnConfig, TokenUsage,
};

/// Engine wrapping the `claude` CLI.
///
/// In the stub phase it keeps a minimal in-memory registry; once the real
/// subprocess code is wired up in milestone 5, the registry will hold
/// [`AgentProcess`] handles instead.
pub struct ClaudeCodeEngine {
    state: Arc<Mutex<EngineState>>,
}

#[derive(Default)]
struct EngineState {
    agents: HashMap<AgentId, StubAgent>,
}

#[derive(Debug, Clone)]
struct StubAgent {
    session_id: String,
    turn: u32,
}

impl ClaudeCodeEngine {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(EngineState::default())),
        }
    }
}

impl Default for ClaudeCodeEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AgentEngine for ClaudeCodeEngine {
    async fn spawn(&self, config: SpawnConfig) -> Result<(), EngineError> {
        let mut state = self.state.lock().await;
        let session_id = config
            .resume_session_id
            .unwrap_or_else(|| format!("stub-{}", uuid::Uuid::new_v4()));
        state.agents.insert(
            config.agent_id.clone(),
            StubAgent {
                session_id,
                turn: 0,
            },
        );
        tracing::info!(agent_id = %config.agent_id, "stub engine: agent registered");
        Ok(())
    }

    async fn send_message(
        &self,
        agent_id: &AgentId,
        message: &str,
    ) -> Result<BoxStream<'static, AgentEvent>, EngineError> {
        let mut state = self.state.lock().await;
        let agent = state
            .agents
            .get_mut(agent_id)
            .ok_or_else(|| EngineError::UnknownAgent(agent_id.clone()))?;

        agent.turn += 1;
        let turn = agent.turn;
        let session_id = agent.session_id.clone();
        let is_first_turn = turn == 1;
        let user_message = message.to_string();
        drop(state);

        // Scripted reply. Small enough to read, large enough to exercise
        // the three interesting branches: plain text, a tool call, a turn
        // completion with usage.
        let mut events: Vec<AgentEvent> = Vec::new();
        if is_first_turn {
            events.push(AgentEvent::SessionStarted {
                session_id: session_id.clone(),
            });
        }
        events.push(AgentEvent::TextDelta {
            content: format!("(stub) I heard: \"{user_message}\". Thinking…\n"),
        });
        events.push(AgentEvent::ToolUseStart {
            tool_id: format!("stub-tool-{turn}"),
            tool_name: "Read".to_string(),
            input: serde_json::json!({ "path": "README.md" }),
        });
        events.push(AgentEvent::ToolUseComplete {
            tool_id: format!("stub-tool-{turn}"),
            tool_name: "Read".to_string(),
            input: serde_json::json!({ "path": "README.md" }),
        });
        events.push(AgentEvent::ToolUseResult {
            tool_id: format!("stub-tool-{turn}"),
            result: "(stub tool result)".to_string(),
            is_error: false,
        });
        events.push(AgentEvent::TextDelta {
            content: "Here is what I would do if I were real.".to_string(),
        });
        events.push(AgentEvent::TurnComplete {
            usage: TokenUsage {
                input_tokens: 100,
                output_tokens: 30,
                cache_read_tokens: 0,
                cache_creation_tokens: 0,
            },
        });

        // Emit with small delays so the frontend streaming path is exercised.
        let stream = futures::stream::iter(events)
            .then(|e| async move {
                tokio::time::sleep(Duration::from_millis(40)).await;
                e
            })
            .boxed();
        Ok(stream)
    }

    async fn terminate(&self, agent_id: &AgentId) -> Result<(), EngineError> {
        let mut state = self.state.lock().await;
        state.agents.remove(agent_id);
        tracing::info!(agent_id = %agent_id, "stub engine: agent terminated");
        Ok(())
    }

    async fn health_check(&self) -> Result<EngineHealth, EngineError> {
        // Stub: pretend Claude Code is installed and authenticated. The
        // real check (milestone 8) looks for the binary, runs `claude
        // --version`, and probes auth.
        Ok(EngineHealth {
            available: true,
            version: Some("stub-0.0.0".to_string()),
            authenticated: true,
            details: "stub engine — replaces with real CLI probe in milestone 8".to_string(),
            executable_path: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::StreamExt;
    use std::path::PathBuf;

    #[tokio::test]
    async fn spawn_then_send_emits_session_started_then_text_and_tool_and_complete() {
        let engine = ClaudeCodeEngine::new();
        engine
            .spawn(SpawnConfig {
                agent_id: "a1".into(),
                working_dir: PathBuf::from("/tmp"),
                model_override: None,
                resume_session_id: None,
            })
            .await
            .unwrap();

        let stream = engine.send_message(&"a1".into(), "hi").await.unwrap();
        let events: Vec<AgentEvent> = stream.collect().await;

        assert!(matches!(events[0], AgentEvent::SessionStarted { .. }));
        assert!(events
            .iter()
            .any(|e| matches!(e, AgentEvent::ToolUseStart { .. })));
        assert!(events
            .iter()
            .any(|e| matches!(e, AgentEvent::ToolUseComplete { .. })));
        assert!(events
            .iter()
            .any(|e| matches!(e, AgentEvent::ToolUseResult { .. })));
        assert!(matches!(
            events.last(),
            Some(AgentEvent::TurnComplete { .. })
        ));
    }

    #[tokio::test]
    async fn send_to_unknown_agent_errors() {
        let engine = ClaudeCodeEngine::new();
        let err = engine
            .send_message(&"ghost".into(), "hi")
            .await
            .unwrap_err();
        assert!(matches!(err, EngineError::UnknownAgent(_)));
    }

    #[tokio::test]
    async fn second_turn_does_not_re_emit_session_started() {
        let engine = ClaudeCodeEngine::new();
        engine
            .spawn(SpawnConfig {
                agent_id: "a1".into(),
                working_dir: PathBuf::from("/tmp"),
                model_override: None,
                resume_session_id: None,
            })
            .await
            .unwrap();
        let _first: Vec<_> = engine
            .send_message(&"a1".into(), "one")
            .await
            .unwrap()
            .collect()
            .await;
        let second: Vec<_> = engine
            .send_message(&"a1".into(), "two")
            .await
            .unwrap()
            .collect()
            .await;
        assert!(!second
            .iter()
            .any(|e| matches!(e, AgentEvent::SessionStarted { .. })));
    }

    #[tokio::test]
    async fn resume_session_id_is_retained() {
        let engine = ClaudeCodeEngine::new();
        engine
            .spawn(SpawnConfig {
                agent_id: "a1".into(),
                working_dir: PathBuf::from("/tmp"),
                model_override: None,
                resume_session_id: Some("resumed-xyz".into()),
            })
            .await
            .unwrap();

        let events: Vec<AgentEvent> = engine
            .send_message(&"a1".into(), "hi")
            .await
            .unwrap()
            .collect()
            .await;

        match &events[0] {
            AgentEvent::SessionStarted { session_id } => {
                assert_eq!(session_id, "resumed-xyz");
            }
            other => panic!("expected SessionStarted, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn terminate_removes_agent_from_registry() {
        let engine = ClaudeCodeEngine::new();
        engine
            .spawn(SpawnConfig {
                agent_id: "a1".into(),
                working_dir: PathBuf::from("/tmp"),
                model_override: None,
                resume_session_id: None,
            })
            .await
            .unwrap();
        engine.terminate(&"a1".into()).await.unwrap();
        let err = engine.send_message(&"a1".into(), "hi").await.unwrap_err();
        assert!(matches!(err, EngineError::UnknownAgent(_)));
    }
}
