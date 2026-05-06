//! Database row types, serializable to the UI via serde.
//!
//! The same struct doubles as both the `FromRow` target and the wire
//! representation for Tauri commands. Fields reserved for later phases
//! (soul/purpose/memory, folder_access, team_id, position) are present but
//! not populated in Phase 1.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

pub type AgentId = String;
pub type ConversationId = String;
pub type MessageId = String;
pub type MemoryEntryId = String;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: AgentId,
    pub name: String,
    pub emoji: String,
    pub color: String,
    pub working_dir: String,
    pub session_id: Option<String>,
    pub model_override: Option<String>,
    pub status: String,

    // Phase 3 — soul/purpose are first-class identity fields. The legacy
    // `memory` TEXT column is unused; per-entry memory rows live in the
    // `memory_entries` table instead.
    pub soul: Option<String>,
    pub purpose: Option<String>,
    #[allow(dead_code)]
    #[serde(skip)]
    pub memory: Option<String>,
    /// 0 = clean, 1 = pending. When 1, the supervisor prepends a
    /// `<system_update>` block to the next user message so the running
    /// Claude Code session picks up edits to soul/purpose/memory without
    /// requiring a full restart.
    pub identity_dirty: i64,

    // Phase 5 — stored as a JSON string in SQLite; empty array by default.
    pub folder_access: String,
    pub team_id: Option<String>,

    // Phase 2 — canvas position. Column is technically nullable at the DB
    // level (leftover from the 0001 placeholder), but migration 0002
    // backfills any NULLs and the application treats these as required.
    pub position_x: f64,
    pub position_y: f64,

    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: ConversationId,
    pub agent_id: AgentId,
    pub created_at: DateTime<Utc>,
}

/// Role string stored in the messages table. We keep it as a plain string
/// rather than an enum on the DB side so schema changes don't require a
/// migration when we add new kinds (e.g. `thinking` in Phase 3).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    User,
    Assistant,
    System,
    ToolUse,
    ToolResult,
}

impl MessageRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::System => "system",
            Self::ToolUse => "tool_use",
            Self::ToolResult => "tool_result",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "user" => Some(Self::User),
            "assistant" => Some(Self::Assistant),
            "system" => Some(Self::System),
            "tool_use" => Some(Self::ToolUse),
            "tool_result" => Some(Self::ToolResult),
            _ => None,
        }
    }
}

/// Source attribution for a memory entry. Surfaces in the UI so users
/// can tell at a glance which entries they wrote, which the agent saved
/// via `remember`, and which were imported from a CLAUDE.md.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MemorySource {
    User,
    Agent,
    Imported,
}

impl MemorySource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Agent => "agent",
            Self::Imported => "imported",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntry {
    pub id: MemoryEntryId,
    pub agent_id: AgentId,
    pub content: String,
    pub category: Option<String>,
    /// "user" | "agent" | "imported" — kept as a string on read so a future
    /// source variant doesn't break older databases.
    pub source: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: MessageId,
    pub conversation_id: ConversationId,
    /// Stored as text, kept as a string on the Rust side so unknown future
    /// role variants don't cause hard decode errors on read.
    pub role: String,
    /// JSON-encoded payload. Shape depends on role:
    /// - `user` / `assistant` / `system`: `{ "text": "..." }`
    /// - `tool_use`: `{ "tool_id": "...", "tool_name": "...", "input": {...} }`
    /// - `tool_result`: `{ "tool_id": "...", "result": "...", "is_error": bool }`
    pub content: String,
    pub created_at: DateTime<Utc>,
}
