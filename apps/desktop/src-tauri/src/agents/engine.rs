//! The `AgentEngine` trait — the single boundary between Orbit's core and
//! any concrete agent runtime.
//!
//! Every core module (supervisor, broker, ipc) must talk to agents only
//! through this trait. Replacing the runtime — e.g. swapping Claude Code
//! for a direct-API engine or a local model — should require zero changes
//! outside this module and `claude_code.rs`.

use std::path::PathBuf;

use async_trait::async_trait;
use futures::stream::BoxStream;
use serde::{Deserialize, Serialize};

pub type AgentId = String;

/// Configuration for starting (or resuming) an agent session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnConfig {
    pub agent_id: AgentId,
    pub working_dir: PathBuf,
    pub model_override: Option<String>,
    /// If `Some`, resume the given Claude Code session instead of starting
    /// fresh. Captured from the `system/init` event on first spawn.
    pub resume_session_id: Option<String>,
    /// Phase 3: appended to Claude Code's default system prompt at spawn
    /// time via `--append-system-prompt`. Built from soul + purpose +
    /// memory by the caller. `None` means use Claude's defaults only —
    /// useful for tests and for the empty-identity case.
    pub system_prompt: Option<String>,
}

/// Token usage reported at the end of a turn.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
}

/// One atomic event on the agent→UI stream. Emitted both by real engines
/// (`ClaudeCodeEngine`) and by test fakes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    /// Fired once per session: the engine successfully initialized.
    SessionStarted { session_id: String },
    /// Incremental assistant text.
    TextDelta { content: String },
    /// Incremental thinking text (extended thinking mode).
    ThinkingDelta { content: String },
    /// A tool call has begun. `input` may be empty at start and fill in via
    /// subsequent events; the final complete input is in the matching
    /// `ToolUseComplete`.
    ToolUseStart {
        tool_id: String,
        tool_name: String,
        input: serde_json::Value,
    },
    /// The tool's input has been fully streamed. Consumers that render a
    /// single collapsed card should wait for this before showing details.
    ToolUseComplete {
        tool_id: String,
        tool_name: String,
        input: serde_json::Value,
    },
    /// The tool has returned.
    ToolUseResult {
        tool_id: String,
        result: String,
        is_error: bool,
    },
    /// The turn has ended cleanly with usage information.
    TurnComplete { usage: TokenUsage },
    /// A runtime error. If `recoverable` is true, the agent remains usable.
    Error { message: String, recoverable: bool },
}

/// Report on whether the engine is usable on this system.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EngineHealth {
    pub available: bool,
    pub version: Option<String>,
    pub authenticated: bool,
    /// Short human-readable description of the state — safe to render in UI.
    pub details: String,
    /// Absolute path to the executable, if we located one.
    pub executable_path: Option<PathBuf>,
}

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("engine is not available: {0}")]
    NotAvailable(String),
    #[error("engine failed to spawn agent: {0}")]
    Spawn(String),
    #[error("agent {0} not found")]
    UnknownAgent(AgentId),
    #[error("engine io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("engine protocol error: {0}")]
    Protocol(String),
    #[error("{0}")]
    Other(String),
}

impl EngineError {
    pub fn user_facing(&self) -> String {
        match self {
            Self::NotAvailable(m) => format!("Agent engine is not available: {m}"),
            Self::Spawn(m) => format!("Failed to spawn agent: {m}"),
            Self::UnknownAgent(id) => format!("Agent {id} is not running."),
            Self::Io(e) => format!("I/O error talking to agent: {e}"),
            Self::Protocol(m) => format!("Unexpected agent output: {m}"),
            Self::Other(m) => m.clone(),
        }
    }
}

/// Abstract agent runtime. One `AgentEngine` instance manages all agents
/// of its kind — the engine holds a registry of live processes keyed by
/// [`AgentId`].
#[async_trait]
pub trait AgentEngine: Send + Sync {
    /// Start (or resume) an agent session. Returns once the session is
    /// live; further events arrive via `send_message`.
    async fn spawn(&self, config: SpawnConfig) -> Result<(), EngineError>;

    /// Send a user message to the named agent. Returns a stream of events
    /// produced by the resulting turn(s), ending in either `TurnComplete`
    /// or `Error`.
    ///
    /// `prepend_system_update` is the Phase 3 in-band identity-update
    /// channel: when the user edits soul/purpose/memory, the supervisor
    /// passes a short `<system_update>...</system_update>` block here
    /// and we prepend it to the message text so the running session
    /// picks up identity changes without a restart. `None` means a
    /// regular user turn.
    async fn send_message(
        &self,
        agent_id: &AgentId,
        message: &str,
        prepend_system_update: Option<&str>,
    ) -> Result<BoxStream<'static, AgentEvent>, EngineError>;

    /// Gracefully terminate an agent. Safe to call if the agent is already
    /// stopped — returns `Ok(())` in that case.
    async fn terminate(&self, agent_id: &AgentId) -> Result<(), EngineError>;

    /// Report whether the engine binary is reachable and authenticated.
    async fn health_check(&self) -> Result<EngineHealth, EngineError>;
}
