//! `#[tauri::command]` handlers for the frontend.
//!
//! Each command is a small adapter: validate input, call into the domain
//! modules (db, agents), format errors as user-facing strings, emit
//! side-channel events where needed.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::agents::engine::{AgentId, EngineHealth, SpawnConfig};
use crate::agents::prompt_builder::{
    AgentSummary, BranchContext, SystemPromptBuilder, MEMORY_INJECTION_CAP,
};
use crate::broker::TurnContext;
use crate::core::AppState;
use crate::db::models::{
    Agent, InterAgentMessage, MemoryEntry, MemorySource, Message, StickyNote, Task, TaskPriority,
    TaskStatus, Team,
};
use crate::db::queries::{
    self, NewAgent, NewMemoryEntry, NewStickyNote, NewTask, NewTeam, WorktreeRecord,
};
use crate::git::{FileDiff, WorktreeManager};

use super::events::{
    AgentIdentityUpdatedPayload, AgentMemoryAddedPayload, AgentStatusChangePayload,
    AgentTaskCreatedPayload, AgentTaskDeletedPayload, AgentTaskUpdatedPayload,
    AgentTerminatedPayload, StickyNoteCreatedPayload, StickyNoteDeletedPayload,
    StickyNoteUpdatedPayload, EVENT_AGENT_IDENTITY_UPDATED, EVENT_AGENT_MEMORY_ADDED,
    EVENT_AGENT_STATUS_CHANGE, EVENT_AGENT_TASK_CREATED, EVENT_AGENT_TASK_DELETED,
    EVENT_AGENT_TASK_UPDATED, EVENT_AGENT_TERMINATED, EVENT_STICKY_NOTE_CREATED,
    EVENT_STICKY_NOTE_DELETED, EVENT_STICKY_NOTE_UPDATED,
};

/// User-facing command error type. Anything that reaches the frontend is
/// a human-readable string — the UI renders it verbatim.
pub type CommandResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(prefix: &str, e: E) -> String {
    format!("{prefix}: {e}")
}

/// Load the agent's identity (soul/purpose + recent memory) and assemble
/// a `SystemPromptBuilder`. Returns the builder ready for `.build()` or
/// `.build_update_block()`.
async fn build_system_prompt_for(
    pool: &sqlx::SqlitePool,
    agent: &Agent,
) -> Result<SystemPromptBuilder, String> {
    let memory = queries::recent_memory_entries(pool, &agent.id, MEMORY_INJECTION_CAP as i64)
        .await
        .map_err(|e| err("Failed to load memory entries", e))?;
    let other_agents = queries::list_agents(pool)
        .await
        .map(|all| {
            all.into_iter()
                .filter(|a| a.id != agent.id)
                .map(|a| AgentSummary {
                    name: a.name,
                    purpose_one_liner: a.purpose.as_deref().map(first_line).unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default();
    let branch = if agent.has_worktree != 0 {
        match (&agent.worktree_branch, &agent.worktree_source_repo) {
            (Some(b), Some(s)) => Some(BranchContext {
                branch: b.clone(),
                source_repo: s.clone(),
            }),
            _ => None,
        }
    } else {
        None
    };
    Ok(SystemPromptBuilder {
        agent_name: agent.name.clone(),
        working_dir: PathBuf::from(&agent.working_dir),
        soul: agent.soul.clone(),
        purpose: agent.purpose.clone(),
        memory,
        other_agents,
        branch,
    })
}

/// Strip multi-line purposes down to the first non-empty line so the
/// teammate roster doesn't blow up the system prompt token budget.
fn first_line(s: &str) -> String {
    s.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_string()
}

/// Decode the JSON-encoded array of allowed folders stored on
/// `agents.folder_access` into a `Vec<PathBuf>`. Tolerates malformed
/// JSON by returning an empty list — the working directory is still
/// implicitly accessible.
fn parse_folder_access(raw: &str) -> Vec<PathBuf> {
    if raw.trim().is_empty() {
        return Vec::new();
    }
    match serde_json::from_str::<Vec<String>>(raw) {
        Ok(v) => v.into_iter().map(PathBuf::from).collect(),
        Err(e) => {
            tracing::warn!(error = %e, raw, "failed to parse folder_access");
            Vec::new()
        }
    }
}

/// Phase 5: check whether a path is reachable for the given agent.
/// A path is allowed if it equals or sits under the agent's working
/// directory or under any folder in its allowlist. Comparisons use
/// canonicalized paths so symlinks and relative segments don't fool
/// the check; if canonicalization fails we fall back to lexical
/// containment as a best-effort guard.
fn validate_path_for_agent(agent: &Agent, target: &std::path::Path) -> Result<(), String> {
    let target_can = target
        .canonicalize()
        .unwrap_or_else(|_| target.to_path_buf());

    let working = PathBuf::from(&agent.working_dir);
    let working_can = working.canonicalize().unwrap_or(working);
    if path_starts_with(&target_can, &working_can) {
        return Ok(());
    }

    for raw in parse_folder_access(&agent.folder_access) {
        let allowed = raw.canonicalize().unwrap_or(raw);
        if path_starts_with(&target_can, &allowed) {
            return Ok(());
        }
    }

    Err(format!(
        "{} is outside this agent's allowed folders.",
        target.display()
    ))
}

fn path_starts_with(target: &std::path::Path, prefix: &std::path::Path) -> bool {
    let tc = target
        .components()
        .map(|c| c.as_os_str())
        .collect::<Vec<_>>();
    let pc = prefix
        .components()
        .map(|c| c.as_os_str())
        .collect::<Vec<_>>();
    if pc.len() > tc.len() {
        return false;
    }
    pc.iter().zip(tc.iter()).all(|(a, b)| a == b)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnAgentInput {
    pub name: String,
    pub emoji: String,
    pub color: String,
    pub working_dir: PathBuf,
    #[serde(default)]
    pub model_override: Option<String>,
    /// Canvas position at which to place the new agent. Defaults to the
    /// origin if omitted — clients that spawn from the canvas always
    /// pass the clicked point.
    #[serde(default)]
    pub position_x: f64,
    #[serde(default)]
    pub position_y: f64,
}

#[tauri::command]
pub async fn agent_spawn(
    state: State<'_, AppState>,
    app: AppHandle,
    input: SpawnAgentInput,
) -> CommandResult<Agent> {
    if input.name.trim().is_empty() {
        return Err("Agent name cannot be empty.".to_string());
    }
    if !input.working_dir.exists() {
        return Err(format!(
            "Working directory does not exist: {}",
            input.working_dir.display()
        ));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let working_dir_str = input.working_dir.to_string_lossy().to_string();

    // Phase 2: soft cap on concurrent agents. We revisit this in later
    // phases; the cap prevents a user from stumbling into OS-level
    // resource issues while the supervisor matures.
    const MAX_AGENTS: i64 = 10;
    let current = queries::count_agents(&state.pool)
        .await
        .map_err(|e| err("Failed to count agents", e))?;
    if current >= MAX_AGENTS {
        return Err(format!(
            "You already have {current} agents running. Terminate some before spawning more (limit: {MAX_AGENTS}).",
        ));
    }

    let agent = queries::insert_agent(
        &state.pool,
        NewAgent {
            id: &id,
            name: &input.name,
            emoji: &input.emoji,
            color: &input.color,
            working_dir: &working_dir_str,
            model_override: input.model_override.as_deref(),
            position_x: input.position_x,
            position_y: input.position_y,
        },
    )
    .await
    .map_err(|e| err("Failed to record agent", e))?;

    // Phase 6: if the working dir sits inside a Git repo, create a
    // worktree and rewrite the agent's working_dir to point at it.
    // Failure here rolls back the agent row so we never ship a
    // half-spawned agent.
    let agent = if WorktreeManager::is_git_repo(&input.working_dir) {
        match state.worktrees.create(&id, &input.name, &input.working_dir) {
            Ok(info) => {
                let path_str = info.path.to_string_lossy().into_owned();
                let source_str = info.source_repo.to_string_lossy().into_owned();
                if let Err(e) = queries::set_agent_worktree(
                    &state.pool,
                    WorktreeRecord {
                        agent_id: &id,
                        worktree_path: &path_str,
                        worktree_branch: &info.branch,
                        worktree_source_repo: &source_str,
                        worktree_base_ref: &info.base_ref,
                    },
                )
                .await
                {
                    // Roll back the worktree if we can't persist; the
                    // agent row is dropped right after.
                    let _ = state.worktrees.remove(
                        &id,
                        &info.path,
                        &info.source_repo,
                        &info.branch,
                        true,
                    );
                    let _ = queries::delete_agent(&state.pool, &id).await;
                    return Err(err("Failed to record worktree metadata", e));
                }
                // Reload the agent so subsequent reads see the
                // rewritten working_dir + worktree fields.
                queries::get_agent(&state.pool, &id)
                    .await
                    .map_err(|e| err("Failed to reload agent", e))?
                    .ok_or_else(|| "Agent disappeared after worktree create.".to_string())?
            }
            Err(e) => {
                let _ = queries::delete_agent(&state.pool, &id).await;
                return Err(format!("Could not set up git worktree: {e}"));
            }
        }
    } else {
        agent
    };

    // Ensure a conversation exists so send_message doesn't have to worry
    // about creating one under a race.
    queries::get_or_create_conversation_for_agent(&state.pool, &id)
        .await
        .map_err(|e| err("Failed to initialize conversation", e))?;

    let system_prompt = build_system_prompt_for(&state.pool, &agent).await?.build();
    let add_dirs = parse_folder_access(&agent.folder_access);
    // Working dir for the engine is the worktree path when one
    // exists, otherwise the original input. The DB column already
    // reflects the right value.
    let engine_working_dir = std::path::PathBuf::from(&agent.working_dir);

    state
        .engine
        .spawn(SpawnConfig {
            agent_id: id.clone(),
            working_dir: engine_working_dir,
            model_override: input.model_override,
            resume_session_id: None,
            system_prompt: Some(system_prompt),
            add_dirs,
        })
        .await
        .map_err(|e| {
            // Roll back: tear down the worktree (if any) and drop the
            // agent row so the caller sees a clean error.
            let pool = state.pool.clone();
            let worktrees = state.worktrees.clone();
            let agent_for_rollback = agent.clone();
            let id_for_rollback = id.clone();
            tokio::spawn(async move {
                if agent_for_rollback.has_worktree != 0 {
                    if let (Some(path), Some(branch), Some(source)) = (
                        agent_for_rollback.worktree_path.as_deref(),
                        agent_for_rollback.worktree_branch.as_deref(),
                        agent_for_rollback.worktree_source_repo.as_deref(),
                    ) {
                        let _ = worktrees.remove(
                            &id_for_rollback,
                            std::path::Path::new(path),
                            std::path::Path::new(source),
                            branch,
                            true,
                        );
                    }
                }
                let _ = queries::delete_agent(&pool, &id_for_rollback).await;
            });
            e.user_facing()
        })?;

    // The agent now has the freshly-built prompt; the dirty flag (if it
    // was set from earlier identity edits — possible on respawn) is
    // cleared so we don't double-inject on the first user turn.
    let _ = queries::set_identity_dirty(&state.pool, &id, false).await;

    queries::update_agent_status(&state.pool, &id, "idle")
        .await
        .map_err(|e| err("Failed to set status", e))?;

    let _ = app.emit(
        EVENT_AGENT_STATUS_CHANGE,
        AgentStatusChangePayload {
            agent_id: id.clone(),
            status: "idle".to_string(),
        },
    );

    Ok(agent)
}

#[tauri::command]
pub async fn agent_list(state: State<'_, AppState>) -> CommandResult<Vec<Agent>> {
    queries::list_agents(&state.pool)
        .await
        .map_err(|e| err("Failed to list agents", e))
}

#[tauri::command]
pub async fn agent_get_conversation(
    state: State<'_, AppState>,
    agent_id: AgentId,
) -> CommandResult<Vec<Message>> {
    queries::list_messages_for_agent(&state.pool, &agent_id, 200)
        .await
        .map_err(|e| err("Failed to load conversation", e))
}

#[tauri::command]
pub async fn agent_send_message(
    state: State<'_, AppState>,
    app: AppHandle,
    agent_id: AgentId,
    message: String,
) -> CommandResult<()> {
    if message.trim().is_empty() {
        return Err("Cannot send an empty message.".to_string());
    }
    // Validate the agent exists before kicking off the turn task.
    queries::get_agent(&state.pool, &agent_id)
        .await
        .map_err(|e| err("Failed to look up agent", e))?
        .ok_or_else(|| format!("Agent {agent_id} not found."))?;

    let ctx = TurnContext {
        pool: state.pool.clone(),
        engine: state.engine.clone(),
        supervisor: state.supervisor.clone(),
        app: app.clone(),
        broker: state.broker.clone(),
    };
    // Phase 5 carryover from the Phase 4 follow-up: route human-
    // initiated turns through the same per-agent queue the broker
    // owns, so a human send while the agent is mid-broker-turn (or
    // vice versa) serializes safely instead of racing the engine's
    // `turn_sender` slot.
    state.broker.enqueue_user_turn(ctx, agent_id, message).await;
    Ok(())
}

#[tauri::command]
pub async fn agent_terminate(
    state: State<'_, AppState>,
    app: AppHandle,
    agent_id: AgentId,
) -> CommandResult<()> {
    state
        .engine
        .terminate(&agent_id)
        .await
        .map_err(|e| e.user_facing())?;
    let _ = queries::update_agent_status(&state.pool, &agent_id, "idle").await;
    let _ = app.emit(
        EVENT_AGENT_TERMINATED,
        AgentTerminatedPayload {
            agent_id: agent_id.clone(),
            reason: "user_requested".to_string(),
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn agent_delete(state: State<'_, AppState>, agent_id: AgentId) -> CommandResult<()> {
    // Best-effort termination — ignore errors (agent may not be running).
    let _ = state.engine.terminate(&agent_id).await;

    // Phase 6: tear down the worktree before dropping the agent row
    // so the libgit2 metadata + on-disk dir + branch all go away
    // together. ON DELETE CASCADE doesn't reach the filesystem.
    if let Ok(Some(agent)) = queries::get_agent(&state.pool, &agent_id).await {
        if agent.has_worktree != 0 {
            if let (Some(path), Some(branch), Some(source)) = (
                agent.worktree_path.as_deref(),
                agent.worktree_branch.as_deref(),
                agent.worktree_source_repo.as_deref(),
            ) {
                let _ = state.worktrees.remove(
                    &agent.id,
                    std::path::Path::new(path),
                    std::path::Path::new(source),
                    branch,
                    true,
                );
            }
        }
    }

    queries::delete_agent(&state.pool, &agent_id)
        .await
        .map_err(|e| err("Failed to delete agent", e))
}

#[tauri::command]
pub async fn agent_update_position(
    state: State<'_, AppState>,
    agent_id: AgentId,
    x: f64,
    y: f64,
) -> CommandResult<()> {
    queries::update_agent_position(&state.pool, &agent_id, x, y)
        .await
        .map_err(|e| err("Failed to update agent position", e))
}

#[tauri::command]
pub async fn agent_rename(
    state: State<'_, AppState>,
    agent_id: AgentId,
    name: String,
) -> CommandResult<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Agent name cannot be empty.".to_string());
    }
    queries::update_agent_name(&state.pool, &agent_id, trimmed)
        .await
        .map_err(|e| err("Failed to rename agent", e))
}

// ─── Phase 3: identity + memory commands ──────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateIdentityInput {
    pub agent_id: AgentId,
    /// `None` means "leave the existing soul untouched". To clear soul,
    /// pass `Some("")`.
    #[serde(default)]
    pub soul: Option<String>,
    #[serde(default)]
    pub purpose: Option<String>,
}

#[tauri::command]
pub async fn agent_update_identity(
    state: State<'_, AppState>,
    app: AppHandle,
    input: UpdateIdentityInput,
) -> CommandResult<()> {
    queries::update_agent_identity(
        &state.pool,
        &input.agent_id,
        input.soul.as_deref(),
        input.purpose.as_deref(),
    )
    .await
    .map_err(|e| err("Failed to update identity", e))?;

    let _ = app.emit(
        EVENT_AGENT_IDENTITY_UPDATED,
        AgentIdentityUpdatedPayload {
            agent_id: input.agent_id,
            identity_dirty: true,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn memory_list(
    state: State<'_, AppState>,
    agent_id: AgentId,
    search: Option<String>,
) -> CommandResult<Vec<MemoryEntry>> {
    queries::list_memory_entries(&state.pool, &agent_id, search.as_deref())
        .await
        .map_err(|e| err("Failed to list memory", e))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMemoryInput {
    pub agent_id: AgentId,
    pub content: String,
    #[serde(default)]
    pub category: Option<String>,
}

#[tauri::command]
pub async fn memory_create(
    state: State<'_, AppState>,
    app: AppHandle,
    input: CreateMemoryInput,
) -> CommandResult<MemoryEntry> {
    let trimmed = input.content.trim();
    if trimmed.is_empty() {
        return Err("Memory entry cannot be empty.".to_string());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let entry = queries::insert_memory_entry(
        &state.pool,
        NewMemoryEntry {
            id: &id,
            agent_id: &input.agent_id,
            content: trimmed,
            category: input.category.as_deref(),
            source: MemorySource::User,
        },
    )
    .await
    .map_err(|e| err("Failed to save memory entry", e))?;

    let _ = app.emit(
        EVENT_AGENT_MEMORY_ADDED,
        AgentMemoryAddedPayload {
            agent_id: input.agent_id.clone(),
            entry: entry.clone(),
        },
    );
    let _ = app.emit(
        EVENT_AGENT_IDENTITY_UPDATED,
        AgentIdentityUpdatedPayload {
            agent_id: input.agent_id,
            identity_dirty: true,
        },
    );
    Ok(entry)
}

#[tauri::command]
pub async fn memory_update(
    state: State<'_, AppState>,
    app: AppHandle,
    memory_id: String,
    content: String,
) -> CommandResult<MemoryEntry> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("Memory entry cannot be empty.".to_string());
    }
    let entry = queries::update_memory_entry(&state.pool, &memory_id, trimmed)
        .await
        .map_err(|e| err("Failed to update memory entry", e))?;
    let _ = app.emit(
        EVENT_AGENT_IDENTITY_UPDATED,
        AgentIdentityUpdatedPayload {
            agent_id: entry.agent_id.clone(),
            identity_dirty: true,
        },
    );
    Ok(entry)
}

#[tauri::command]
pub async fn memory_delete(
    state: State<'_, AppState>,
    app: AppHandle,
    memory_id: String,
    agent_id: AgentId,
) -> CommandResult<()> {
    queries::delete_memory_entry(&state.pool, &memory_id)
        .await
        .map_err(|e| err("Failed to delete memory entry", e))?;
    let _ = app.emit(
        EVENT_AGENT_IDENTITY_UPDATED,
        AgentIdentityUpdatedPayload {
            agent_id,
            identity_dirty: true,
        },
    );
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportClaudeMdResult {
    pub imported: bool,
    pub source_path: Option<String>,
}

/// Look for a `CLAUDE.md` in the agent's working directory and, if
/// present, set its contents as the agent's Purpose. Also drops a
/// memory entry with `source = 'imported'` noting where it came from.
#[tauri::command]
pub async fn agent_import_claude_md(
    state: State<'_, AppState>,
    app: AppHandle,
    agent_id: AgentId,
) -> CommandResult<ImportClaudeMdResult> {
    let agent = queries::get_agent(&state.pool, &agent_id)
        .await
        .map_err(|e| err("Failed to look up agent", e))?
        .ok_or_else(|| format!("Agent {agent_id} not found."))?;

    let path = PathBuf::from(&agent.working_dir).join("CLAUDE.md");
    // Phase 5: even though CLAUDE.md sits inside the working dir
    // (which is implicitly allowed), we route through
    // validate_path_for_agent so any future relocation of this
    // command goes through the same guard rail.
    validate_path_for_agent(&agent, &path)?;
    let contents = match tokio::fs::read_to_string(&path).await {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ImportClaudeMdResult {
                imported: false,
                source_path: None,
            });
        }
        Err(e) => return Err(err("Failed to read CLAUDE.md", e)),
    };

    queries::update_agent_identity(&state.pool, &agent.id, None, Some(&contents))
        .await
        .map_err(|e| err("Failed to set imported purpose", e))?;

    let mid = uuid::Uuid::new_v4().to_string();
    let note = format!("Imported purpose from {}", path.display());
    let _ = queries::insert_memory_entry(
        &state.pool,
        NewMemoryEntry {
            id: &mid,
            agent_id: &agent.id,
            content: &note,
            category: Some("import"),
            source: MemorySource::Imported,
        },
    )
    .await;

    let _ = app.emit(
        EVENT_AGENT_IDENTITY_UPDATED,
        AgentIdentityUpdatedPayload {
            agent_id: agent.id,
            identity_dirty: true,
        },
    );

    Ok(ImportClaudeMdResult {
        imported: true,
        source_path: Some(path.display().to_string()),
    })
}

// ─── Phase 5: teams + folder access ───────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTeamInput {
    pub name: String,
    pub color: String,
}

#[tauri::command]
pub async fn team_create(
    state: State<'_, AppState>,
    input: CreateTeamInput,
) -> CommandResult<Team> {
    if input.name.trim().is_empty() {
        return Err("Team name cannot be empty.".to_string());
    }
    let id = uuid::Uuid::new_v4().to_string();
    queries::insert_team(
        &state.pool,
        NewTeam {
            id: &id,
            name: input.name.trim(),
            color: &input.color,
        },
    )
    .await
    .map_err(|e| err("Failed to create team", e))
}

#[tauri::command]
pub async fn team_list(state: State<'_, AppState>) -> CommandResult<Vec<Team>> {
    queries::list_teams(&state.pool)
        .await
        .map_err(|e| err("Failed to list teams", e))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTeamInput {
    pub team_id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

#[tauri::command]
pub async fn team_update(state: State<'_, AppState>, input: UpdateTeamInput) -> CommandResult<()> {
    queries::update_team(
        &state.pool,
        &input.team_id,
        input.name.as_deref(),
        input.color.as_deref(),
    )
    .await
    .map_err(|e| err("Failed to update team", e))
}

#[tauri::command]
pub async fn team_delete(state: State<'_, AppState>, team_id: String) -> CommandResult<()> {
    queries::delete_team(&state.pool, &team_id)
        .await
        .map_err(|e| err("Failed to delete team", e))
}

/// Set or clear an agent's team membership. Pass `team_id = None` to
/// unassign. Drag-into-team flows call this on `onNodeDragStop`.
#[tauri::command]
pub async fn agent_set_team(
    state: State<'_, AppState>,
    agent_id: AgentId,
    team_id: Option<String>,
) -> CommandResult<()> {
    queries::set_agent_team(&state.pool, &agent_id, team_id.as_deref())
        .await
        .map_err(|e| err("Failed to update team membership", e))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFolderAccessInput {
    pub agent_id: AgentId,
    pub folders: Vec<String>,
}

/// Replace the agent's folder allowlist. Working dir is implicit and
/// never appears in this list. Phase 5 spawns pass each entry to
/// Claude Code via `--add-dir`.
#[tauri::command]
pub async fn agent_update_folder_access(
    state: State<'_, AppState>,
    input: UpdateFolderAccessInput,
) -> CommandResult<()> {
    // Canonicalize and dedupe before persisting so the allowlist
    // doesn't carry duplicates or relative paths that would silently
    // not match.
    let mut seen = std::collections::BTreeSet::new();
    for raw in &input.folders {
        let p = PathBuf::from(raw);
        let canonical = p.canonicalize().unwrap_or(p);
        seen.insert(canonical.to_string_lossy().into_owned());
    }
    let normalized: Vec<String> = seen.into_iter().collect();
    let json = serde_json::to_string(&normalized)
        .map_err(|e| err("Failed to serialise folder access", e))?;
    queries::update_agent_folder_access(&state.pool, &input.agent_id, &json)
        .await
        .map_err(|e| err("Failed to update folder access", e))
}

// ─── Phase 6: git diff / branch info ──────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub branch: String,
    pub source_repo: String,
    pub base_branch: Option<String>,
    pub base_ref: String,
    pub current_commit: String,
    pub worktree_path: String,
}

#[tauri::command]
pub async fn agent_get_diff(
    state: State<'_, AppState>,
    agent_id: AgentId,
) -> CommandResult<Vec<FileDiff>> {
    let agent = queries::get_agent(&state.pool, &agent_id)
        .await
        .map_err(|e| err("Failed to look up agent", e))?
        .ok_or_else(|| format!("Agent {agent_id} not found."))?;
    if agent.has_worktree == 0 {
        return Ok(Vec::new());
    }
    let (Some(path), Some(base)) = (
        agent.worktree_path.as_deref(),
        agent.worktree_base_ref.as_deref(),
    ) else {
        return Ok(Vec::new());
    };
    state
        .worktrees
        .diff(std::path::Path::new(path), base)
        .map_err(|e| format!("Failed to compute diff: {e}"))
}

#[tauri::command]
pub async fn agent_get_branch_info(
    state: State<'_, AppState>,
    agent_id: AgentId,
) -> CommandResult<Option<BranchInfo>> {
    let agent = queries::get_agent(&state.pool, &agent_id)
        .await
        .map_err(|e| err("Failed to look up agent", e))?
        .ok_or_else(|| format!("Agent {agent_id} not found."))?;
    if agent.has_worktree == 0 {
        return Ok(None);
    }
    let (path, branch, source, base_ref) = match (
        agent.worktree_path.clone(),
        agent.worktree_branch.clone(),
        agent.worktree_source_repo.clone(),
        agent.worktree_base_ref.clone(),
    ) {
        (Some(p), Some(b), Some(s), Some(r)) => (p, b, s, r),
        _ => return Ok(None),
    };
    let current_commit = state
        .worktrees
        .current_commit(std::path::Path::new(&path))
        .unwrap_or_else(|_| base_ref.clone());
    Ok(Some(BranchInfo {
        branch,
        source_repo: source,
        // Phase 6 doesn't persist the base branch label separately —
        // the prompt addendum and UI both display the branch name
        // alongside the source repo path. Set None for now and add a
        // column later if the UI needs it standalone.
        base_branch: None,
        base_ref,
        current_commit,
        worktree_path: path,
    }))
}

// ─── Phase 4: inter-agent message inspection ──────────────────────────────

/// Recent inter-agent messages either to or from the given agent,
/// newest first. Used by the right-panel Inbox view.
#[tauri::command]
pub async fn agent_get_inter_agent_messages(
    state: State<'_, AppState>,
    agent_id: AgentId,
    limit: Option<i64>,
) -> CommandResult<Vec<InterAgentMessage>> {
    queries::list_inter_agent_messages_for_agent(&state.pool, &agent_id, limit.unwrap_or(100))
        .await
        .map_err(|e| err("Failed to load inter-agent messages", e))
}

/// System-wide audit log. Useful for debugging and the future Phase 7
/// status report view.
#[tauri::command]
pub async fn agent_get_audit_log(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> CommandResult<Vec<InterAgentMessage>> {
    queries::list_inter_agent_audit_log(&state.pool, limit.unwrap_or(200))
        .await
        .map_err(|e| err("Failed to load audit log", e))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemHealth {
    pub engine: EngineHealth,
}

// ─── Phase 7: tasks + sticky notes + activity feed ────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub agent_id: AgentId,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
}

#[tauri::command]
pub async fn task_create(
    state: State<'_, AppState>,
    app: AppHandle,
    input: CreateTaskInput,
) -> CommandResult<Task> {
    if input.title.trim().is_empty() {
        return Err("Task title cannot be empty.".to_string());
    }
    let status = input
        .status
        .as_deref()
        .and_then(TaskStatus::parse)
        .unwrap_or(TaskStatus::Queued);
    let priority = input
        .priority
        .as_deref()
        .and_then(TaskPriority::parse)
        .unwrap_or(TaskPriority::Normal);
    let id = uuid::Uuid::new_v4().to_string();
    let task = queries::insert_task(
        &state.pool,
        NewTask {
            id: &id,
            agent_id: &input.agent_id,
            title: input.title.trim(),
            description: input.description.as_deref(),
            status,
            priority,
        },
    )
    .await
    .map_err(|e| err("Failed to create task", e))?;
    let _ = app.emit(
        EVENT_AGENT_TASK_CREATED,
        AgentTaskCreatedPayload { task: task.clone() },
    );
    Ok(task)
}

#[tauri::command]
pub async fn task_list(state: State<'_, AppState>, agent_id: AgentId) -> CommandResult<Vec<Task>> {
    queries::list_tasks_for_agent(&state.pool, &agent_id)
        .await
        .map_err(|e| err("Failed to list tasks", e))
}

/// Inbox view: every task across every agent, newest-updated first.
#[tauri::command]
pub async fn task_list_all(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> CommandResult<Vec<Task>> {
    queries::list_all_tasks(&state.pool, limit.unwrap_or(500))
        .await
        .map_err(|e| err("Failed to load tasks", e))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskInput {
    pub task_id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
}

#[tauri::command]
pub async fn task_update(
    state: State<'_, AppState>,
    app: AppHandle,
    input: UpdateTaskInput,
) -> CommandResult<Task> {
    let status = input.status.as_deref().and_then(TaskStatus::parse);
    let priority = input.priority.as_deref().and_then(TaskPriority::parse);
    let task = queries::update_task(
        &state.pool,
        &input.task_id,
        input.title.as_deref(),
        input.description.as_deref(),
        status,
        priority,
    )
    .await
    .map_err(|e| err("Failed to update task", e))?;
    let _ = app.emit(
        EVENT_AGENT_TASK_UPDATED,
        AgentTaskUpdatedPayload { task: task.clone() },
    );
    Ok(task)
}

#[tauri::command]
pub async fn task_delete(
    state: State<'_, AppState>,
    app: AppHandle,
    task_id: String,
    agent_id: AgentId,
) -> CommandResult<()> {
    queries::delete_task(&state.pool, &task_id)
        .await
        .map_err(|e| err("Failed to delete task", e))?;
    let _ = app.emit(
        EVENT_AGENT_TASK_DELETED,
        AgentTaskDeletedPayload { task_id, agent_id },
    );
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStickyNoteInput {
    pub content: String,
    pub position_x: f64,
    pub position_y: f64,
    pub color: String,
}

#[tauri::command]
pub async fn sticky_note_create(
    state: State<'_, AppState>,
    app: AppHandle,
    input: CreateStickyNoteInput,
) -> CommandResult<StickyNote> {
    let id = uuid::Uuid::new_v4().to_string();
    let note = queries::insert_sticky_note(
        &state.pool,
        NewStickyNote {
            id: &id,
            content: &input.content,
            position_x: input.position_x,
            position_y: input.position_y,
            color: &input.color,
        },
    )
    .await
    .map_err(|e| err("Failed to create sticky note", e))?;
    let _ = app.emit(
        EVENT_STICKY_NOTE_CREATED,
        StickyNoteCreatedPayload { note: note.clone() },
    );
    Ok(note)
}

#[tauri::command]
pub async fn sticky_note_list(state: State<'_, AppState>) -> CommandResult<Vec<StickyNote>> {
    queries::list_sticky_notes(&state.pool)
        .await
        .map_err(|e| err("Failed to list sticky notes", e))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStickyNoteInput {
    pub note_id: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub position_x: Option<f64>,
    #[serde(default)]
    pub position_y: Option<f64>,
    #[serde(default)]
    pub color: Option<String>,
}

#[tauri::command]
pub async fn sticky_note_update(
    state: State<'_, AppState>,
    app: AppHandle,
    input: UpdateStickyNoteInput,
) -> CommandResult<StickyNote> {
    let position = match (input.position_x, input.position_y) {
        (Some(x), Some(y)) => Some((x, y)),
        _ => None,
    };
    let note = queries::update_sticky_note(
        &state.pool,
        &input.note_id,
        input.content.as_deref(),
        position,
        input.color.as_deref(),
    )
    .await
    .map_err(|e| err("Failed to update sticky note", e))?;
    let _ = app.emit(
        EVENT_STICKY_NOTE_UPDATED,
        StickyNoteUpdatedPayload { note: note.clone() },
    );
    Ok(note)
}

#[tauri::command]
pub async fn sticky_note_delete(
    state: State<'_, AppState>,
    app: AppHandle,
    note_id: String,
) -> CommandResult<()> {
    queries::delete_sticky_note(&state.pool, &note_id)
        .await
        .map_err(|e| err("Failed to delete sticky note", e))?;
    let _ = app.emit(
        EVENT_STICKY_NOTE_DELETED,
        StickyNoteDeletedPayload { note_id },
    );
    Ok(())
}

/// Phase 7: chronological feed of recent agent activity. Union of
/// task state transitions + agent-saved memory entries. ADR 0009.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntry {
    /// `'task'` or `'memory'`.
    pub kind: String,
    pub agent_id: AgentId,
    pub timestamp: String,
    /// One-line summary (truncated). Frontends format; we hand them
    /// fields they need.
    pub title: String,
    pub status: Option<String>,
    pub task_id: Option<String>,
    pub memory_id: Option<String>,
}

#[tauri::command]
pub async fn agent_get_activity_feed(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> CommandResult<Vec<ActivityEntry>> {
    let cap = limit.unwrap_or(50);
    let tasks = queries::list_all_tasks(&state.pool, cap)
        .await
        .map_err(|e| err("Failed to load tasks", e))?;
    let mut entries: Vec<ActivityEntry> = Vec::new();
    for t in tasks {
        entries.push(ActivityEntry {
            kind: "task".into(),
            agent_id: t.agent_id.clone(),
            timestamp: t.updated_at.to_rfc3339(),
            title: t.title.clone(),
            status: Some(t.status.clone()),
            task_id: Some(t.id.clone()),
            memory_id: None,
        });
    }
    // Agent-saved memory entries across all agents.
    let agent_memories: Vec<MemoryEntry> = sqlx::query_as::<_, MemoryEntry>(
        "SELECT * FROM memory_entries WHERE source = 'agent' ORDER BY created_at DESC LIMIT ?",
    )
    .bind(cap)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| err("Failed to load memory entries", e))?;
    for m in agent_memories {
        entries.push(ActivityEntry {
            kind: "memory".into(),
            agent_id: m.agent_id.clone(),
            timestamp: m.created_at.to_rfc3339(),
            title: m.content.clone(),
            status: None,
            task_id: None,
            memory_id: Some(m.id.clone()),
        });
    }
    entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    entries.truncate(cap as usize);
    Ok(entries)
}

/// Phase 6: open the platform's file manager at the given path.
/// Best-effort and intentionally minimal — used by the Settings →
/// Branch section's "Reveal worktree" button. Errors are swallowed
/// into a user-facing message.
#[tauri::command]
pub async fn system_reveal_path(path: String) -> CommandResult<()> {
    let target = std::path::PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(all(unix, not(target_os = "macos")))]
    let cmd = "xdg-open";

    std::process::Command::new(cmd)
        .arg(&target)
        .spawn()
        .map_err(|e| format!("Failed to open file manager: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn system_health_check(state: State<'_, AppState>) -> CommandResult<SystemHealth> {
    let engine = state
        .engine
        .health_check()
        .await
        .map_err(|e| e.user_facing())?;
    Ok(SystemHealth { engine })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn agent_with(working_dir: &str, folder_access: &str) -> Agent {
        Agent {
            id: "a".into(),
            name: "A".into(),
            emoji: "🌟".into(),
            color: "#000".into(),
            working_dir: working_dir.into(),
            session_id: None,
            model_override: None,
            status: "idle".into(),
            soul: None,
            purpose: None,
            memory: None,
            identity_dirty: 0,
            folder_access: folder_access.into(),
            team_id: None,
            position_x: 0.0,
            position_y: 0.0,
            has_worktree: 0,
            worktree_path: None,
            worktree_branch: None,
            worktree_source_repo: None,
            worktree_base_ref: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn parse_folder_access_handles_empty_and_malformed_input() {
        assert!(parse_folder_access("").is_empty());
        assert!(parse_folder_access("   ").is_empty());
        assert!(parse_folder_access("not json").is_empty());
        let parsed = parse_folder_access("[\"/home/me/api\",\"/home/me/lib\"]");
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].to_string_lossy(), "/home/me/api");
    }

    #[test]
    fn validate_path_allows_working_dir_descendants() {
        let agent = agent_with("/tmp", "[]");
        assert!(validate_path_for_agent(&agent, std::path::Path::new("/tmp")).is_ok());
        assert!(validate_path_for_agent(&agent, std::path::Path::new("/tmp/nested/file")).is_ok());
    }

    #[test]
    fn validate_path_rejects_outside_paths() {
        let agent = agent_with("/tmp/api", "[]");
        let err =
            validate_path_for_agent(&agent, std::path::Path::new("/var/log/syslog")).unwrap_err();
        assert!(err.contains("outside"));
    }

    #[test]
    fn validate_path_allows_allowlisted_folder_descendants() {
        let agent = agent_with("/tmp/api", "[\"/usr/local/lib\"]");
        assert!(
            validate_path_for_agent(&agent, std::path::Path::new("/usr/local/lib/zoneinfo"))
                .is_ok()
        );
        // Sibling outside both the working dir and the allowlist.
        assert!(validate_path_for_agent(&agent, std::path::Path::new("/usr/local/share")).is_err());
    }
}
