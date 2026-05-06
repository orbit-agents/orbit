//! Claude Code CLI engine.
//!
//! Spawns one long-lived `claude` subprocess per agent, talks to it over
//! stdin/stdout using newline-delimited stream-json on both sides.
//!
//! The invocation is:
//!
//! ```text
//! claude --print \
//!        --output-format stream-json \
//!        --input-format  stream-json \
//!        --verbose \
//!        --permission-mode bypassPermissions \
//!        [--resume <session_id>]
//! ```
//!
//! Cross-platform concerns:
//!
//! - On Windows we set `CREATE_NO_WINDOW` to suppress the flashing console
//!   window that would otherwise appear for each child.
//! - Graceful termination uses SIGTERM on Unix with a 3-second grace
//!   window before SIGKILL; on Windows it falls through to `Child::kill`.
//! - Executable discovery walks `PATH` first, then a small list of
//!   well-known install locations (see [`discover_claude_executable`]).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use futures::stream::BoxStream;
use futures::StreamExt;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::{mpsc, Mutex};

use super::engine::{AgentEngine, AgentEvent, AgentId, EngineError, EngineHealth, SpawnConfig};
use super::stream_json::StreamJsonParser;

const CLAUDE_BINARY_NAMES: &[&str] = &["claude", "claude.cmd", "claude.exe"];

/// Maximum size of the stderr ring buffer (bytes). Keeps memory bounded
/// for noisy failures while retaining enough context for a useful error.
const STDERR_RING_BYTES: usize = 4 * 1024;

/// Grace period between SIGTERM and SIGKILL.
const TERMINATE_GRACE: Duration = Duration::from_secs(3);

pub struct ClaudeCodeEngine {
    /// Override the `claude` executable location (useful for tests and
    /// users whose CLI lives in a non-standard place). `None` triggers
    /// [`discover_claude_executable`].
    executable_override: Option<PathBuf>,
    state: Arc<Mutex<EngineState>>,
}

#[derive(Default)]
struct EngineState {
    agents: HashMap<AgentId, Arc<AgentProcess>>,
}

struct AgentProcess {
    child: Mutex<Child>,
    stdin_tx: mpsc::Sender<String>,
    /// Sender for the currently-active turn. `None` between turns; set by
    /// `send_message` and cleared by the stdout reader when it sees the
    /// terminal event.
    turn_sender: Arc<Mutex<Option<mpsc::Sender<AgentEvent>>>>,
    /// Rolling tail of the child's stderr for diagnostics. Held for the
    /// life of the process; surfaced in error reports in a follow-up.
    #[allow(dead_code)]
    stderr_ring: Arc<Mutex<Vec<u8>>>,
}

impl ClaudeCodeEngine {
    pub fn new() -> Self {
        Self {
            executable_override: None,
            state: Arc::new(Mutex::new(EngineState::default())),
        }
    }

    pub fn with_executable(path: PathBuf) -> Self {
        Self {
            executable_override: Some(path),
            state: Arc::new(Mutex::new(EngineState::default())),
        }
    }

    fn resolve_executable(&self) -> Result<PathBuf, EngineError> {
        if let Some(p) = &self.executable_override {
            return Ok(p.clone());
        }
        discover_claude_executable().ok_or_else(|| {
            EngineError::NotAvailable(
                "could not find the `claude` executable on PATH or in known install locations"
                    .into(),
            )
        })
    }

    async fn get_agent(&self, id: &AgentId) -> Result<Arc<AgentProcess>, EngineError> {
        let state = self.state.lock().await;
        state
            .agents
            .get(id)
            .cloned()
            .ok_or_else(|| EngineError::UnknownAgent(id.clone()))
    }
}

impl Default for ClaudeCodeEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AgentEngine for ClaudeCodeEngine {
    async fn spawn(&self, config: SpawnConfig) -> Result<(), EngineError> {
        let binary = self.resolve_executable()?;

        let mut cmd = Command::new(&binary);
        cmd.current_dir(&config.working_dir)
            .arg("--print")
            .arg("--output-format")
            .arg("stream-json")
            .arg("--input-format")
            .arg("stream-json")
            .arg("--verbose")
            .arg("--permission-mode")
            .arg("bypassPermissions");

        if let Some(model) = &config.model_override {
            cmd.arg("--model").arg(model);
        }
        if let Some(session) = &config.resume_session_id {
            cmd.arg("--resume").arg(session);
        }
        if let Some(prompt) = &config.system_prompt {
            // `--append-system-prompt` keeps Claude Code's default system
            // prompt (tool docs etc.) and appends our identity block, so
            // the model still knows how to use Read/Edit/Bash/etc.
            cmd.arg("--append-system-prompt").arg(prompt);
        }

        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        configure_child_platform(&mut cmd);

        let mut child: Child = cmd
            .spawn()
            .map_err(|e| EngineError::Spawn(format!("failed to spawn `claude`: {e}")))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| EngineError::Spawn("child stdin was not captured".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| EngineError::Spawn("child stdout was not captured".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| EngineError::Spawn("child stderr was not captured".into()))?;

        let (stdin_tx, stdin_rx) = mpsc::channel::<String>(16);
        let turn_sender = Arc::new(Mutex::new(None::<mpsc::Sender<AgentEvent>>));
        let stderr_ring = Arc::new(Mutex::new(Vec::<u8>::with_capacity(STDERR_RING_BYTES)));

        tokio::spawn(stdin_writer(stdin, stdin_rx));
        tokio::spawn(stdout_reader(stdout, Arc::clone(&turn_sender)));
        tokio::spawn(stderr_reader(stderr, Arc::clone(&stderr_ring)));

        let process = Arc::new(AgentProcess {
            child: Mutex::new(child),
            stdin_tx,
            turn_sender,
            stderr_ring,
        });

        let mut state = self.state.lock().await;
        state.agents.insert(config.agent_id.clone(), process);
        tracing::info!(
            agent_id = %config.agent_id,
            binary = %binary.display(),
            working_dir = %config.working_dir.display(),
            "claude subprocess started",
        );
        Ok(())
    }

    async fn send_message(
        &self,
        agent_id: &AgentId,
        message: &str,
        prepend_system_update: Option<&str>,
    ) -> Result<BoxStream<'static, AgentEvent>, EngineError> {
        let agent = self.get_agent(agent_id).await?;

        let (turn_tx, turn_rx) = mpsc::channel::<AgentEvent>(64);
        {
            let mut slot = agent.turn_sender.lock().await;
            *slot = Some(turn_tx);
        }

        // Identity updates land in-band as a `<system_update>` block
        // prepended to the user text — see ADR 0005 / prompt_builder.rs.
        let text = match prepend_system_update {
            Some(prefix) if !prefix.is_empty() => format!("{prefix}{message}"),
            _ => message.to_string(),
        };

        let payload = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": text}]
            }
        })
        .to_string();

        agent
            .stdin_tx
            .send(payload)
            .await
            .map_err(|e| EngineError::Io(std::io::Error::new(std::io::ErrorKind::BrokenPipe, e)))?;

        let stream = tokio_stream::wrappers::ReceiverStream::new(turn_rx).boxed();
        Ok(stream)
    }

    async fn terminate(&self, agent_id: &AgentId) -> Result<(), EngineError> {
        let agent = {
            let mut state = self.state.lock().await;
            state.agents.remove(agent_id)
        };
        let Some(agent) = agent else {
            return Ok(());
        };

        // Close stdin so a well-behaved child exits on its own.
        drop(agent.stdin_tx.clone());
        let mut child = agent.child.lock().await;
        terminate_child(&mut child).await;
        tracing::info!(agent_id = %agent_id, "claude subprocess terminated");
        Ok(())
    }

    async fn health_check(&self) -> Result<EngineHealth, EngineError> {
        let binary = match self.resolve_executable() {
            Ok(p) => p,
            Err(e) => {
                return Ok(EngineHealth {
                    available: false,
                    version: None,
                    authenticated: false,
                    details: e.user_facing(),
                    executable_path: None,
                });
            }
        };

        let mut cmd = Command::new(&binary);
        cmd.arg("--version");
        configure_child_platform(&mut cmd);

        // A missing binary at the override path produces NotFound from
        // tokio's spawn; treat that the same as resolution failure so the
        // setup view can render the install instructions instead of
        // surfacing an error.
        let output = match cmd.output().await {
            Ok(o) => o,
            Err(e) => {
                return Ok(EngineHealth {
                    available: false,
                    version: None,
                    authenticated: false,
                    details: format!("failed to run `{} --version`: {e}", binary.display()),
                    executable_path: Some(binary),
                });
            }
        };

        if !output.status.success() {
            return Ok(EngineHealth {
                available: false,
                version: None,
                authenticated: false,
                details: format!("`{} --version` exited {}", binary.display(), output.status),
                executable_path: Some(binary),
            });
        }

        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let short = version_short(&version).to_string();

        // Claude Code stores credentials on first run. We probe auth by
        // running a cheap no-op and watching for the specific auth error.
        // For Phase 1 we trust `--version` success as a proxy; Phase 2
        // can tighten this with a real probe.
        Ok(EngineHealth {
            available: true,
            version: Some(version),
            authenticated: true,
            details: format!("claude {short} at {}", binary.display()),
            executable_path: Some(binary),
        })
    }
}

fn version_short(v: &str) -> &str {
    v.split_whitespace().next().unwrap_or(v)
}

async fn stdin_writer(mut stdin: ChildStdin, mut rx: mpsc::Receiver<String>) {
    while let Some(line) = rx.recv().await {
        if let Err(e) = stdin.write_all(line.as_bytes()).await {
            tracing::warn!(error = %e, "stdin write failed");
            break;
        }
        if let Err(e) = stdin.write_all(b"\n").await {
            tracing::warn!(error = %e, "stdin newline failed");
            break;
        }
        if let Err(e) = stdin.flush().await {
            tracing::warn!(error = %e, "stdin flush failed");
            break;
        }
    }
}

async fn stdout_reader(
    stdout: ChildStdout,
    turn_sender: Arc<Mutex<Option<mpsc::Sender<AgentEvent>>>>,
) {
    let mut parser = StreamJsonParser::new();
    let mut lines = BufReader::new(stdout).lines();

    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                for event in parser.feed_line(&line) {
                    let terminal = matches!(
                        &event,
                        AgentEvent::TurnComplete { .. } | AgentEvent::Error { .. }
                    );
                    let slot = turn_sender.lock().await;
                    if let Some(tx) = slot.as_ref() {
                        let _ = tx.send(event).await;
                    }
                    drop(slot);
                    if terminal {
                        let mut slot = turn_sender.lock().await;
                        *slot = None;
                    }
                }
            }
            Ok(None) => {
                // EOF. Signal a clean shutdown to any waiting turn.
                let mut slot = turn_sender.lock().await;
                if let Some(tx) = slot.take() {
                    let _ = tx
                        .send(AgentEvent::Error {
                            message: "agent subprocess exited".into(),
                            recoverable: false,
                        })
                        .await;
                }
                break;
            }
            Err(e) => {
                tracing::warn!(error = %e, "stdout read error");
                let mut slot = turn_sender.lock().await;
                if let Some(tx) = slot.take() {
                    let _ = tx
                        .send(AgentEvent::Error {
                            message: format!("agent stdout error: {e}"),
                            recoverable: false,
                        })
                        .await;
                }
                break;
            }
        }
    }
}

async fn stderr_reader(stderr: ChildStderr, ring: Arc<Mutex<Vec<u8>>>) {
    let mut reader = BufReader::new(stderr);
    let mut buf = [0u8; 1024];
    loop {
        use tokio::io::AsyncReadExt;
        match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                let mut r = ring.lock().await;
                r.extend_from_slice(&buf[..n]);
                if r.len() > STDERR_RING_BYTES {
                    let overflow = r.len() - STDERR_RING_BYTES;
                    r.drain(..overflow);
                }
            }
            Err(e) => {
                tracing::warn!(error = %e, "stderr read error");
                break;
            }
        }
    }
}

#[cfg(unix)]
async fn terminate_child(child: &mut Child) {
    let pid = match child.id() {
        Some(p) => p,
        None => return, // already exited
    };

    // SAFETY: libc::kill is only unsafe because it takes an integer PID; we
    // pass one we just read from the child process — if the child already
    // exited the OS returns ESRCH which we ignore.
    unsafe {
        libc::kill(pid as i32, libc::SIGTERM);
    }

    match tokio::time::timeout(TERMINATE_GRACE, child.wait()).await {
        Ok(_) => {}
        Err(_) => {
            tracing::warn!("child did not exit after SIGTERM; sending SIGKILL");
            let _ = child.kill().await;
        }
    }
}

#[cfg(not(unix))]
async fn terminate_child(child: &mut Child) {
    // Windows has no SIGTERM; the child does not get a chance to flush.
    let _ = child.kill().await;
    let _ = child.wait().await;
}

#[cfg(windows)]
fn configure_child_platform(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_child_platform(_cmd: &mut Command) {
    // No-op on Unix.
}

/// Search for the `claude` CLI executable on this system.
///
/// Strategy:
/// 1. `PATH` via `which`-style lookup.
/// 2. Well-known install locations that the official installer writes to
///    even when `PATH` has not been refreshed in the current GUI session.
pub fn discover_claude_executable() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("ORBIT_CLAUDE_PATH") {
        let p = PathBuf::from(path);
        if p.is_file() {
            return Some(p);
        }
    }

    if let Some(p) = which_on_path() {
        return Some(p);
    }

    let home = dirs_home_dir();
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(h) = &home {
        candidates.push(h.join(".claude/local/claude"));
        candidates.push(h.join(".claude/local/node_modules/.bin/claude"));
        candidates.push(h.join(".local/bin/claude"));
        candidates.push(h.join(".npm-global/bin/claude"));
    }
    #[cfg(unix)]
    {
        candidates.push(PathBuf::from("/usr/local/bin/claude"));
        candidates.push(PathBuf::from("/opt/homebrew/bin/claude"));
    }
    #[cfg(windows)]
    if let Ok(appdata) = std::env::var("APPDATA") {
        let p = PathBuf::from(appdata).join("npm").join("claude.cmd");
        candidates.push(p);
    }

    candidates.into_iter().find(|p| p.is_file())
}

fn which_on_path() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for name in CLAUDE_BINARY_NAMES {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn dirs_home_dir() -> Option<PathBuf> {
    #[cfg(unix)]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    /// A tiny helper for tests: write a shell script that mimics the
    /// `claude` CLI by emitting a canned sequence of stream-json events
    /// then exiting.
    fn write_fake_claude(content: &str) -> (tempfile::TempDir, PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude");
        std::fs::write(&path, content).unwrap();
        let mut perms = std::fs::metadata(&path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&path, perms).unwrap();
        (dir, path)
    }

    #[tokio::test]
    async fn spawn_and_send_message_streams_events_from_fake_subprocess() {
        let script = r#"#!/usr/bin/env bash
# Ignore all args; read one line of NDJSON from stdin, then emit a fake
# session_started + assistant text + result, then exit.
read -r _line
printf '%s\n' '{"type":"system","subtype":"init","session_id":"fake-123"}'
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"hello from fake"}]}}'
printf '%s\n' '{"type":"result","subtype":"success","usage":{"input_tokens":1,"output_tokens":2}}'
"#;
        let (_dir, script_path) = write_fake_claude(script);

        let engine = ClaudeCodeEngine::with_executable(script_path);
        let working_dir = std::env::temp_dir();

        engine
            .spawn(SpawnConfig {
                agent_id: "a1".into(),
                working_dir: working_dir.clone(),
                model_override: None,
                resume_session_id: None,
                system_prompt: None,
            })
            .await
            .unwrap();

        let stream = engine.send_message(&"a1".into(), "hi", None).await.unwrap();
        let events: Vec<AgentEvent> = stream.collect().await;

        assert!(
            events.iter().any(|e| matches!(
                e,
                AgentEvent::SessionStarted { session_id } if session_id == "fake-123"
            )),
            "expected SessionStarted; got {events:?}"
        );
        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::TextDelta { content } if content == "hello from fake"
        )));
        assert!(matches!(
            events.last(),
            Some(AgentEvent::TurnComplete { .. })
        ));

        engine.terminate(&"a1".into()).await.unwrap();
    }

    #[tokio::test]
    async fn send_message_to_unknown_agent_errors() {
        let engine = ClaudeCodeEngine::new();
        // `BoxStream` doesn't implement Debug, so we can't use `unwrap_err`.
        match engine.send_message(&"ghost".into(), "hi", None).await {
            Err(EngineError::UnknownAgent(_)) => {}
            Err(other) => panic!("expected UnknownAgent, got {other:?}"),
            Ok(_) => panic!("expected an error"),
        }
    }

    #[tokio::test]
    async fn health_check_with_missing_binary_is_available_false() {
        let engine = ClaudeCodeEngine::with_executable(PathBuf::from("/definitely/not/here"));
        let h = engine.health_check().await.unwrap();
        assert!(!h.available);
    }
}
