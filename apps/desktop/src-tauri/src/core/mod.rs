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
use crate::agents::prompt_builder::{AgentSummary, SystemPromptBuilder, MEMORY_INJECTION_CAP};
use crate::agents::supervisor::SharedSupervisor;
use crate::broker::SharedBroker;
use crate::db::queries;

/// Everything IPC commands need to talk to the world.
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub engine: Arc<dyn AgentEngine>,
    pub supervisor: SharedSupervisor,
    pub broker: SharedBroker,
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
    for agent in &agents {
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

        // Build the latest identity prompt from DB state. If the user
        // edited soul/purpose/memory while the app was closed those
        // changes land in this prompt — and we also flip identity_dirty
        // so the next user turn carries a `<system_update>` block as a
        // belt-and-braces guarantee that the resumed model sees the
        // latest values even if Claude Code's `--resume` ignores
        // `--append-system-prompt`.
        let memory = queries::recent_memory_entries(pool, &agent.id, MEMORY_INJECTION_CAP as i64)
            .await
            .unwrap_or_default();
        let other_agents = agents
            .iter()
            .filter(|a| a.id != agent.id)
            .map(|a| AgentSummary {
                name: a.name.clone(),
                purpose_one_liner: a
                    .purpose
                    .as_deref()
                    .and_then(|p| p.lines().map(str::trim).find(|l| !l.is_empty()))
                    .unwrap_or("")
                    .to_string(),
            })
            .collect();
        let prompt = SystemPromptBuilder {
            agent_name: agent.name.clone(),
            working_dir: working_dir.clone(),
            soul: agent.soul.clone(),
            purpose: agent.purpose.clone(),
            memory,
            other_agents,
        }
        .build();

        let cfg = SpawnConfig {
            agent_id: agent.id.clone(),
            working_dir,
            model_override: agent.model_override.clone(),
            resume_session_id: agent.session_id.clone(),
            system_prompt: Some(prompt),
        };
        match engine.spawn(cfg).await {
            Ok(()) => {
                tracing::info!(agent_id = %agent.id, "rehydrated agent");
                let _ = queries::update_agent_status(pool, &agent.id, "idle").await;
                let _ = queries::set_identity_dirty(pool, &agent.id, true).await;
            }
            Err(e) => {
                tracing::error!(agent_id = %agent.id, error = %e, "failed to rehydrate agent");
                let _ = queries::update_agent_status(pool, &agent.id, "error").await;
            }
        }
    }
    Ok(())
}
