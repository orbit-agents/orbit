//! Phase 8: per-agent PTY terminal.
//!
//! When the user opens the Terminal tab on an agent, the frontend
//! calls `terminal_open(agent_id)`. The backend spawns a shell PTY
//! rooted at the agent's `working_dir`, streams stdout to the
//! frontend via `terminal:data` events, and accepts stdin via
//! `terminal_write`. Closing the tab fires `terminal_close`, which
//! kills the child and drops the registry entry.
//!
//! Lifetime: one PTY per (agent × open Terminal tab). Phase 8 ships
//! the simple model — no backgrounding, no reconnect across app
//! restart. If you close and reopen the tab, you get a new shell.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::agents::engine::AgentId;

pub const EVENT_TERMINAL_DATA: &str = "terminal:data";
pub const EVENT_TERMINAL_EXIT: &str = "terminal:exit";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDataPayload {
    pub agent_id: AgentId,
    /// Best-effort UTF-8 — the PTY emits raw bytes; we lossy-decode
    /// here so xterm.js can render it.
    pub chunk: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitPayload {
    pub agent_id: AgentId,
    pub reason: String,
}

struct PtySession {
    /// Master end (resize lives here).
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    /// Writer is taken once at open time and reused; `take_writer`
    /// is single-use on the libmaster side, so we keep the result.
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    /// Held so the child isn't reaped early.
    _child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
}

#[derive(Default)]
pub struct TerminalRegistry {
    sessions: Mutex<HashMap<AgentId, Arc<PtySession>>>,
}

pub type SharedTerminalRegistry = Arc<TerminalRegistry>;

impl TerminalRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Open (or reopen) a terminal for `agent_id` rooted at
    /// `working_dir`. Replacing an existing session kills the
    /// previous child first.
    pub async fn open(
        self: &Arc<Self>,
        app: AppHandle,
        agent_id: AgentId,
        working_dir: std::path::PathBuf,
    ) -> Result<(), String> {
        // Drop any prior session for this agent so we don't leak a child.
        self.close(&agent_id).await;

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 30,
                cols: 100,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("failed to open pty: {e}"))?;

        let shell = default_shell();
        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(&working_dir);
        // PATH inherits via the shell; don't reset env.

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("failed to spawn shell `{shell}`: {e}"))?;
        // The slave end can be dropped now — the child holds it open.
        drop(pair.slave);

        // Pump stdout on a blocking-IO thread (portable-pty isn't
        // async). Tauri's Emitter is Send so we hand the AppHandle
        // into the thread directly.
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("failed to clone pty reader: {e}"))?;
        let app_for_reader = app.clone();
        let agent_for_reader = agent_id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                        let _ = app_for_reader.emit(
                            EVENT_TERMINAL_DATA,
                            TerminalDataPayload {
                                agent_id: agent_for_reader.clone(),
                                chunk,
                            },
                        );
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, agent_id = %agent_for_reader, "pty read failed");
                        break;
                    }
                }
            }
            let _ = app_for_reader.emit(
                EVENT_TERMINAL_EXIT,
                TerminalExitPayload {
                    agent_id: agent_for_reader.clone(),
                    reason: "shell exited".to_string(),
                },
            );
        });

        // Take the writer once — `take_writer` is single-use on
        // libmaster.
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("failed to take pty writer: {e}"))?;

        let session = Arc::new(PtySession {
            master: Arc::new(Mutex::new(pair.master)),
            writer: Arc::new(Mutex::new(writer)),
            _child: Arc::new(Mutex::new(child)),
        });
        let mut sessions = self.sessions.lock().await;
        sessions.insert(agent_id, session);
        Ok(())
    }

    pub async fn write(&self, agent_id: &AgentId, data: &str) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let Some(session) = sessions.get(agent_id).cloned() else {
            return Err("Terminal is not open for this agent.".to_string());
        };
        drop(sessions);
        let mut writer = session.writer.lock().await;
        writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("failed to write to pty: {e}"))?;
        writer.flush().ok();
        Ok(())
    }

    pub async fn resize(&self, agent_id: &AgentId, rows: u16, cols: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let Some(session) = sessions.get(agent_id).cloned() else {
            return Ok(());
        };
        drop(sessions);
        let master = session.master.lock().await;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("failed to resize pty: {e}"))
    }

    pub async fn close(&self, agent_id: &AgentId) {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.remove(agent_id) {
            // Best-effort: kill the child so the reader thread exits.
            let mut child = session._child.lock().await;
            let _ = child.kill();
        }
    }
}

#[cfg(target_os = "windows")]
fn default_shell() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
}

#[cfg(not(target_os = "windows"))]
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}
