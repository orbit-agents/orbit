//! Per-agent supervisor.
//!
//! A thin layer on top of [`AgentEngine`] that persists messages to
//! SQLite and broadcasts events. Milestones 6 and 7 flesh this out with
//! the streaming pipeline and write-through-then-broadcast semantics.
//!
//! This module owns nothing engine-specific — it talks only to the
//! trait. Tests can substitute a fake engine.

use std::sync::Arc;

use tokio::sync::broadcast;

use super::engine::{AgentEvent, AgentId};

/// Events the supervisor broadcasts to subscribers (Tauri command layer,
/// tests). A single broadcast channel is shared by all agents; the `agent_id`
/// distinguishes them.
#[derive(Debug, Clone)]
pub struct SupervisedEvent {
    pub agent_id: AgentId,
    pub event: AgentEvent,
}

#[derive(Clone)]
pub struct Supervisor {
    tx: broadcast::Sender<SupervisedEvent>,
}

impl Supervisor {
    pub fn new(capacity: usize) -> Self {
        let (tx, _rx) = broadcast::channel(capacity.max(64));
        Self { tx }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SupervisedEvent> {
        self.tx.subscribe()
    }

    pub fn sender(&self) -> broadcast::Sender<SupervisedEvent> {
        self.tx.clone()
    }

    /// Broadcast an event to all subscribers. Returns the number of
    /// subscribers that successfully received it (0 is not an error — we
    /// may emit before the UI has attached a listener).
    pub fn emit(&self, evt: SupervisedEvent) -> usize {
        self.tx.send(evt).unwrap_or(0)
    }
}

impl Default for Supervisor {
    fn default() -> Self {
        Self::new(256)
    }
}

pub type SharedSupervisor = Arc<Supervisor>;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::engine::TokenUsage;

    #[tokio::test]
    async fn emit_reaches_subscriber() {
        let sup = Supervisor::new(16);
        let mut rx = sup.subscribe();

        sup.emit(SupervisedEvent {
            agent_id: "a".into(),
            event: AgentEvent::TurnComplete {
                usage: TokenUsage::default(),
            },
        });

        let got = rx.recv().await.unwrap();
        assert_eq!(got.agent_id, "a");
        assert!(matches!(got.event, AgentEvent::TurnComplete { .. }));
    }

    #[tokio::test]
    async fn late_subscriber_only_sees_events_after_subscribe() {
        let sup = Supervisor::new(16);
        sup.emit(SupervisedEvent {
            agent_id: "a".into(),
            event: AgentEvent::TextDelta {
                content: "one".into(),
            },
        });

        let mut rx = sup.subscribe();
        sup.emit(SupervisedEvent {
            agent_id: "a".into(),
            event: AgentEvent::TextDelta {
                content: "two".into(),
            },
        });

        let got = rx.recv().await.unwrap();
        match got.event {
            AgentEvent::TextDelta { content } => assert_eq!(content, "two"),
            other => panic!("expected text delta, got {other:?}"),
        }
    }
}
