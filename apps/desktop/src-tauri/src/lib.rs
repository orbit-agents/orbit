//! Orbit core library.
//!
//! Module layout follows the architecture split from CLAUDE.md:
//!
//! - [`core`]   process supervisor, app state, lifecycle
//! - [`agents`] agent registry and the `AgentEngine` trait boundary
//! - [`broker`] inter-agent message broker (Phase 4)
//! - [`db`]     SQLite schema, migrations, queries
//! - [`git`]    git worktree manager (Phase 6)
//! - [`ipc`]    Tauri command handlers exposed to the UI

pub mod agents;
pub mod broker;
pub mod core;
pub mod db;
pub mod git;
pub mod ipc;

use std::sync::Arc;

use tauri::Manager;
use tracing_subscriber::EnvFilter;

use crate::agents::claude_code::ClaudeCodeEngine;
use crate::agents::supervisor::Supervisor;
use crate::broker::Broker;
use crate::core::AppState;
use crate::git::WorktreeManager;

const DB_FILENAME: &str = "orbit.db";

/// Entry point invoked from `main.rs`. Builds the Tauri app and starts the
/// event loop.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ipc::commands::agent_spawn,
            ipc::commands::agent_list,
            ipc::commands::agent_get_conversation,
            ipc::commands::agent_send_message,
            ipc::commands::agent_terminate,
            ipc::commands::agent_delete,
            ipc::commands::agent_update_position,
            ipc::commands::agent_rename,
            ipc::commands::agent_update_identity,
            ipc::commands::agent_import_claude_md,
            ipc::commands::memory_list,
            ipc::commands::memory_create,
            ipc::commands::memory_update,
            ipc::commands::memory_delete,
            ipc::commands::agent_get_inter_agent_messages,
            ipc::commands::agent_get_audit_log,
            ipc::commands::team_create,
            ipc::commands::team_list,
            ipc::commands::team_update,
            ipc::commands::team_delete,
            ipc::commands::agent_set_team,
            ipc::commands::agent_update_folder_access,
            ipc::commands::agent_get_diff,
            ipc::commands::agent_get_branch_info,
            ipc::commands::task_create,
            ipc::commands::task_list,
            ipc::commands::task_list_all,
            ipc::commands::task_update,
            ipc::commands::task_delete,
            ipc::commands::sticky_note_create,
            ipc::commands::sticky_note_list,
            ipc::commands::sticky_note_update,
            ipc::commands::sticky_note_delete,
            ipc::commands::agent_get_activity_feed,
            ipc::commands::system_reveal_path,
            ipc::commands::system_health_check,
        ])
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
            std::fs::create_dir_all(&data_dir)
                .map_err(|e| format!("cannot create data dir {}: {e}", data_dir.display()))?;

            let db_path = data_dir.join(DB_FILENAME);
            let pool = tauri::async_runtime::block_on(db::open(&db_path))
                .map_err(|e| format!("database initialization failed: {e}"))?;

            let supervisor = Arc::new(Supervisor::default());
            let engine: Arc<dyn crate::agents::engine::AgentEngine> =
                Arc::new(ClaudeCodeEngine::new());
            let broker = Arc::new(Broker::new(pool.clone()));
            // Phase 6: per-agent worktrees live under
            // <data-dir>/worktrees/<agent-id>. The directory is
            // created lazily by WorktreeManager.create.
            let worktrees = Arc::new(WorktreeManager::new(data_dir.join("worktrees")));

            // Rehydrate persisted agents best-effort so users find their
            // conversations alive after a restart.
            let pool_for_rehydrate = pool.clone();
            let engine_for_rehydrate = Arc::clone(&engine);
            tauri::async_runtime::spawn(async move {
                if let Err(e) =
                    core::rehydrate_agents(&pool_for_rehydrate, &*engine_for_rehydrate).await
                {
                    tracing::error!(error = %e, "rehydration failed");
                }
            });

            let state = AppState {
                pool,
                engine,
                supervisor,
                broker,
                worktrees,
                data_dir: data_dir.clone(),
            };
            app.manage(state);

            tracing::info!(data_dir = %data_dir.display(), "orbit started");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running orbit");
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,orbit_lib=debug"));
    tracing_subscriber::fmt().with_env_filter(filter).init();
}
