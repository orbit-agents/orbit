//! Orbit core library.
//!
//! Module layout follows the architecture split from CLAUDE.md:
//!
//! - [`core`]   process supervisor, lifecycle
//! - [`agents`] agent registry and the `AgentEngine` trait boundary
//! - [`broker`] inter-agent message broker (all agent-to-agent traffic)
//! - [`db`]     SQLite schema, migrations, queries
//! - [`git`]    git worktree manager
//! - [`ipc`]    Tauri command handlers exposed to the UI
//!
//! Phase 0 intentionally leaves every module empty. Implementation begins in
//! Phase 1 with `agents::ClaudeCodeEngine` and the first IPC commands.

pub mod agents;
pub mod broker;
pub mod core;
pub mod db;
pub mod git;
pub mod ipc;

use tracing_subscriber::EnvFilter;

/// Entry point invoked from `main.rs`. Builds the Tauri app and starts the
/// event loop.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| {
            tracing::info!("orbit starting up");
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
