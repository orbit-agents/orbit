//! Core: process supervisor, app state, lifecycle.
//!
//! `AppState` is the single object installed into Tauri's managed state.
//! Every IPC command reads and mutates the world through it. Owning the
//! database pool, the engine, and the supervisor in one place keeps the
//! lifecycle legible.

use std::path::PathBuf;
use std::sync::Arc;

use sqlx::SqlitePool;

use crate::agents::engine::{AgentEngine, SpawnConfig};
use crate::agents::supervisor::SharedSupervisor;
use crate::db::queries;

/// Everything IPC commands need to talk to the world.
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub engine: Arc<dyn AgentEngine>,
    pub supervisor: SharedSupervisor,
    pub data_dir: PathBuf,
}

/// On application startup, re-spawn a subprocess for every persisted
/// agent, resuming its Claude Code session if we captured a session_id.
///
/// This runs best-effort: individual agent failures are logged and then
/// ignored so the app can still launch when only some agents are in a
/// bad state (e.g. their working directory was moved or deleted).
pub async fn rehydrate_agents(
    pool: &SqlitePool,
    engine: &dyn AgentEngine,
) -> Result<(), crate::db::DbError> {
    let agents = queries::list_agents(pool).await?;
    for agent in agents {
        let working_dir = PathBuf::from(&agent.working_dir);
        if !working_dir.exists() {
            tracing::warn!(
                agent_id = %agent.id,
                working_dir = %working_dir.display(),
                "skipping rehydration: working dir no longer exists",
            );
            let _ = queries::update_agent_status(pool, &agent.id, "error").await;
            continue;
        }

        let cfg = SpawnConfig {
            agent_id: agent.id.clone(),
            working_dir,
            model_override: agent.model_override.clone(),
            resume_session_id: agent.session_id.clone(),
        };
        match engine.spawn(cfg).await {
            Ok(()) => {
                tracing::info!(agent_id = %agent.id, "rehydrated agent");
                let _ = queries::update_agent_status(pool, &agent.id, "idle").await;
            }
            Err(e) => {
                tracing::error!(agent_id = %agent.id, error = %e, "failed to rehydrate agent");
                let _ = queries::update_agent_status(pool, &agent.id, "error").await;
            }
        }
    }
    Ok(())
}
