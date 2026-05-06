//! `#[tauri::command]` handlers for the frontend.
//!
//! Each command is a small adapter: validate input, call into the domain
//! modules (db, agents), format errors as user-facing strings, emit
//! side-channel events where needed.

use std::path::PathBuf;

use chrono::Utc;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::agents::engine::{AgentEvent, AgentId, EngineHealth, SpawnConfig};
use crate::agents::prompt_builder::{SystemPromptBuilder, MEMORY_INJECTION_CAP};
use crate::agents::remember;
use crate::agents::supervisor::SupervisedEvent;
use crate::core::AppState;
use crate::db::models::{Agent, MemoryEntry, MemorySource, Message, MessageRole};
use crate::db::queries::{self, NewAgent, NewMemoryEntry, NewMessage};

use super::events::{
    AgentAssistantMessagePersistedPayload, AgentEventPayload, AgentIdentityUpdatedPayload,
    AgentMemoryAddedPayload, AgentStatusChangePayload, AgentTerminatedPayload,
    EVENT_AGENT_ASSISTANT_MESSAGE_PERSISTED, EVENT_AGENT_EVENT, EVENT_AGENT_IDENTITY_UPDATED,
    EVENT_AGENT_MEMORY_ADDED, EVENT_AGENT_STATUS_CHANGE, EVENT_AGENT_TERMINATED,
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
    Ok(SystemPromptBuilder {
        agent_name: agent.name.clone(),
        working_dir: PathBuf::from(&agent.working_dir),
        soul: agent.soul.clone(),
        purpose: agent.purpose.clone(),
        memory,
        other_agents: vec![],
    })
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

    // Ensure a conversation exists so send_message doesn't have to worry
    // about creating one under a race.
    queries::get_or_create_conversation_for_agent(&state.pool, &id)
        .await
        .map_err(|e| err("Failed to initialize conversation", e))?;

    let system_prompt = build_system_prompt_for(&state.pool, &agent).await?.build();

    state
        .engine
        .spawn(SpawnConfig {
            agent_id: id.clone(),
            working_dir: input.working_dir,
            model_override: input.model_override,
            resume_session_id: None,
            system_prompt: Some(system_prompt),
        })
        .await
        .map_err(|e| e.user_facing())?;

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
    let agent = queries::get_agent(&state.pool, &agent_id)
        .await
        .map_err(|e| err("Failed to look up agent", e))?
        .ok_or_else(|| format!("Agent {agent_id} not found."))?;

    let conversation = queries::get_or_create_conversation_for_agent(&state.pool, &agent.id)
        .await
        .map_err(|e| err("Failed to resolve conversation", e))?;

    // Persist the user message first (write-then-emit).
    let user_message_id = uuid::Uuid::new_v4().to_string();
    let user_content = serde_json::json!({ "text": message }).to_string();
    queries::insert_message(
        &state.pool,
        NewMessage {
            id: &user_message_id,
            conversation_id: &conversation.id,
            role: MessageRole::User,
            content: &user_content,
            created_at: Utc::now(),
        },
    )
    .await
    .map_err(|e| err("Failed to persist user message", e))?;

    // Broadcast a status change so the UI can show "active".
    queries::update_agent_status(&state.pool, &agent.id, "active")
        .await
        .ok();
    let _ = app.emit(
        EVENT_AGENT_STATUS_CHANGE,
        AgentStatusChangePayload {
            agent_id: agent.id.clone(),
            status: "active".to_string(),
        },
    );

    // If identity has been edited since the last turn, build a short
    // <system_update> block to prepend to this user message. See ADR 0005.
    let prepend = if agent.identity_dirty != 0 {
        let block = build_system_prompt_for(&state.pool, &agent)
            .await?
            .build_update_block();
        Some(block)
    } else {
        None
    };

    let stream = state
        .engine
        .send_message(&agent.id, &message, prepend.as_deref())
        .await
        .map_err(|e| e.user_facing())?;

    // Best-effort: clear the dirty flag now that the update is in flight.
    // If the engine call above had failed we'd never reach this — the
    // flag stays set so the next turn retries.
    if prepend.is_some() {
        let _ = queries::set_identity_dirty(&state.pool, &agent.id, false).await;
        let _ = app.emit(
            EVENT_AGENT_IDENTITY_UPDATED,
            AgentIdentityUpdatedPayload {
                agent_id: agent.id.clone(),
                identity_dirty: false,
            },
        );
    }

    let app_handle = app.clone();
    let pool = state.pool.clone();
    let supervisor_tx = state.supervisor.sender();
    let agent_id_for_task = agent.id.clone();
    let conversation_id_for_task = conversation.id.clone();

    tokio::spawn(async move {
        let mut stream = stream;
        let mut assistant_text = String::new();

        while let Some(event) = stream.next().await {
            let _ = app_handle.emit(
                EVENT_AGENT_EVENT,
                AgentEventPayload {
                    agent_id: agent_id_for_task.clone(),
                    event: event.clone(),
                },
            );
            let _ = supervisor_tx.send(SupervisedEvent {
                agent_id: agent_id_for_task.clone(),
                event: event.clone(),
            });

            match &event {
                AgentEvent::SessionStarted { session_id } => {
                    if let Err(e) =
                        queries::update_agent_session_id(&pool, &agent_id_for_task, session_id)
                            .await
                    {
                        tracing::warn!(error = %e, "failed to persist session_id");
                    }
                }
                AgentEvent::TextDelta { content } => {
                    assistant_text.push_str(content);
                }
                AgentEvent::ThinkingDelta { .. } => {
                    // Phase 3: persist thinking so it can be replayed.
                }
                AgentEvent::ToolUseComplete {
                    tool_id,
                    tool_name,
                    input,
                } => {
                    let content_json = serde_json::json!({
                        "tool_id": tool_id,
                        "tool_name": tool_name,
                        "input": input,
                    })
                    .to_string();
                    let id = uuid::Uuid::new_v4().to_string();
                    if let Err(e) = queries::insert_message(
                        &pool,
                        NewMessage {
                            id: &id,
                            conversation_id: &conversation_id_for_task,
                            role: MessageRole::ToolUse,
                            content: &content_json,
                            created_at: Utc::now(),
                        },
                    )
                    .await
                    {
                        tracing::warn!(error = %e, "failed to persist tool_use");
                    }
                }
                AgentEvent::ToolUseResult {
                    tool_id,
                    result,
                    is_error,
                } => {
                    let content_json = serde_json::json!({
                        "tool_id": tool_id,
                        "result": result,
                        "is_error": is_error,
                    })
                    .to_string();
                    let id = uuid::Uuid::new_v4().to_string();
                    if let Err(e) = queries::insert_message(
                        &pool,
                        NewMessage {
                            id: &id,
                            conversation_id: &conversation_id_for_task,
                            role: MessageRole::ToolResult,
                            content: &content_json,
                            created_at: Utc::now(),
                        },
                    )
                    .await
                    {
                        tracing::warn!(error = %e, "failed to persist tool_result");
                    }
                }
                AgentEvent::TurnComplete { .. } => {
                    // Extract <remember> markers from the assembled
                    // assistant text (ADR 0005). The persisted message
                    // is the cleaned text — markers never reach the
                    // Message row, so the UI re-renders cleanly on
                    // refresh.
                    let (cleaned_text, memories) = remember::extract_memories(&assistant_text);

                    if !cleaned_text.is_empty() {
                        let content_json = serde_json::json!({ "text": cleaned_text }).to_string();
                        let id = uuid::Uuid::new_v4().to_string();
                        match queries::insert_message(
                            &pool,
                            NewMessage {
                                id: &id,
                                conversation_id: &conversation_id_for_task,
                                role: MessageRole::Assistant,
                                content: &content_json,
                                created_at: Utc::now(),
                            },
                        )
                        .await
                        {
                            Ok(message) => {
                                let _ = app_handle.emit(
                                    EVENT_AGENT_ASSISTANT_MESSAGE_PERSISTED,
                                    AgentAssistantMessagePersistedPayload {
                                        agent_id: agent_id_for_task.clone(),
                                        message,
                                    },
                                );
                            }
                            Err(e) => {
                                tracing::warn!(error = %e, "failed to persist assistant message");
                            }
                        }
                    }

                    for mem in memories {
                        if mem.truncated {
                            tracing::warn!(
                                agent_id = %agent_id_for_task,
                                "remember marker exceeded length cap; entry truncated to 8KB",
                            );
                        }
                        let mid = uuid::Uuid::new_v4().to_string();
                        match queries::insert_memory_entry(
                            &pool,
                            NewMemoryEntry {
                                id: &mid,
                                agent_id: &agent_id_for_task,
                                content: &mem.content,
                                category: None,
                                source: MemorySource::Agent,
                            },
                        )
                        .await
                        {
                            Ok(entry) => {
                                let _ = app_handle.emit(
                                    EVENT_AGENT_MEMORY_ADDED,
                                    AgentMemoryAddedPayload {
                                        agent_id: agent_id_for_task.clone(),
                                        entry,
                                    },
                                );
                            }
                            Err(e) => {
                                tracing::warn!(error = %e, "failed to persist agent memory");
                            }
                        }
                    }

                    let _ = queries::update_agent_status(&pool, &agent_id_for_task, "idle").await;
                    let _ = app_handle.emit(
                        EVENT_AGENT_STATUS_CHANGE,
                        AgentStatusChangePayload {
                            agent_id: agent_id_for_task.clone(),
                            status: "idle".to_string(),
                        },
                    );
                    break;
                }
                AgentEvent::Error { .. } => {
                    let _ = queries::update_agent_status(&pool, &agent_id_for_task, "error").await;
                    let _ = app_handle.emit(
                        EVENT_AGENT_STATUS_CHANGE,
                        AgentStatusChangePayload {
                            agent_id: agent_id_for_task.clone(),
                            status: "error".to_string(),
                        },
                    );
                    break;
                }
                _ => {}
            }
        }
    });

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemHealth {
    pub engine: EngineHealth,
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
