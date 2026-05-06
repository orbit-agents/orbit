//! Event names and payload types emitted from Rust to the frontend.
//!
//! Every event name is declared here so the TS side can import the
//! constants via a shared file or just string-match them. The payload
//! types are Serialize + Deserialize so they round-trip through Tauri's
//! serde bridge cleanly.

use serde::{Deserialize, Serialize};

use crate::agents::engine::{AgentEvent, AgentId};
use crate::db::models::{InterAgentMessage, MemoryEntry, Message};

pub const EVENT_AGENT_EVENT: &str = "agent:event";
pub const EVENT_AGENT_STATUS_CHANGE: &str = "agent:status_change";
pub const EVENT_AGENT_TERMINATED: &str = "agent:terminated";
pub const EVENT_AGENT_MEMORY_ADDED: &str = "agent:memory_added";
pub const EVENT_AGENT_IDENTITY_UPDATED: &str = "agent:identity_updated";
/// Fired after `TurnComplete` once the assistant message has been
/// extracted, cleaned of `<remember>` markers, and persisted. The
/// frontend treats this as the cue to swap the streaming bubble for
/// the persisted row and clear the streaming buffer.
pub const EVENT_AGENT_ASSISTANT_MESSAGE_PERSISTED: &str = "agent:assistant_message_persisted";
/// Phase 4: a `<send_to>` marker was successfully validated by the
/// broker and an audit row written. The flight animation begins on
/// receipt of this event and ends on `delivered` / `acknowledged`.
pub const EVENT_AGENT_INTER_AGENT_MESSAGE_DISPATCHED: &str = "agent:inter_agent_message_dispatched";
/// Phase 4: the broker rejected a `<send_to>` (self-send, depth,
/// unknown recipient, etc.). The sender's UI surfaces this as a
/// soft warning.
pub const EVENT_AGENT_INTER_AGENT_MESSAGE_FAILED: &str = "agent:inter_agent_message_failed";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEventPayload {
    pub agent_id: AgentId,
    pub event: AgentEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusChangePayload {
    pub agent_id: AgentId,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTerminatedPayload {
    pub agent_id: AgentId,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryAddedPayload {
    pub agent_id: AgentId,
    pub entry: MemoryEntry,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentIdentityUpdatedPayload {
    pub agent_id: AgentId,
    /// Mirrors `agents.identity_dirty` after the change. The frontend
    /// uses this to show / clear the "Identity pending" pill.
    pub identity_dirty: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAssistantMessagePersistedPayload {
    pub agent_id: AgentId,
    pub message: Message,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInterAgentMessageDispatchedPayload {
    pub message: InterAgentMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInterAgentMessageFailedPayload {
    pub from_agent_id: AgentId,
    pub to_agent_name: String,
    /// Stable machine-readable tag from `BrokerError::tag()`:
    /// `unknown_recipient`, `self_send`, `depth_exceeded`, `db_error`.
    pub reason: String,
    pub detail: String,
}
