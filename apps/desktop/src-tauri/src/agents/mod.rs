//! Agent registry, the `AgentEngine` trait boundary, and its concrete
//! implementations.
//!
//! Everything specific to an agent runtime (currently: the Claude Code CLI)
//! lives under this module. Code outside `agents::` must talk to agents
//! only through [`engine::AgentEngine`] — never via engine-specific APIs.
//! See CLAUDE.md rule 6.

pub mod claude_code;
pub mod engine;
pub mod prompt_builder;
pub mod remember;
pub mod stream_json;
pub mod supervisor;

pub use engine::{
    AgentEngine, AgentEvent, AgentId, EngineError, EngineHealth, SpawnConfig, TokenUsage,
};
