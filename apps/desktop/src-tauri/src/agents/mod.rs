//! Agent registry and the `AgentEngine` trait.
//!
//! The trait is the boundary between Orbit's core and any concrete agent
//! runtime (Claude Code CLI today, other engines later). All core code must
//! talk to agents through this trait — never call engine-specific APIs
//! directly from elsewhere.
//!
//! Phase 1 implements `ClaudeCodeEngine`.

use async_trait::async_trait;

/// Errors raised by an agent engine.
#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("engine failed to spawn agent: {0}")]
    Spawn(String),
    #[error("engine io error: {0}")]
    Io(#[from] std::io::Error),
}

/// Abstract agent runtime. Implementations wrap a specific CLI or SDK.
#[async_trait]
pub trait AgentEngine: Send + Sync {
    /// Start a new agent process in `working_dir` with the given system prompt.
    async fn spawn(&self, working_dir: &std::path::Path, system_prompt: &str) -> Result<AgentHandle, EngineError>;
}

/// Opaque handle to a running agent process. Phase 1 will flesh this out.
pub struct AgentHandle {
    pub id: String,
}
