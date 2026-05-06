//! Per-turn orchestration: run a turn for an agent, persist its
//! messages, extract pseudo-tools, dispatch outbound `<send_to>`s.
//!
//! The body is reused by two entrypoints:
//!
//! - [`run_user_turn`] — a human typed something into agent X's chat.
//! - [`run_inbound_turn`] — the broker delivered a message from agent A
//!   to agent B; B treats it as a synthetic user turn.
//!
//! The shared body lives in [`run_turn`]; the two entrypoints differ
//! only in how they shape the user-role message content (the
//! synthetic user message carries `fromAgentId` so the chat panel can
//! render it as "from Atlas" instead of "user") and in what they do
//! when the turn finishes (the inbound path also marks the originating
//! `inter_agent_messages` row as `acknowledged`).

use chrono::Utc;
use futures::StreamExt;
use tauri::Emitter;

use crate::agents::engine::AgentEvent;
use crate::agents::extract;
use crate::agents::prompt_builder::{AgentSummary, SystemPromptBuilder, MEMORY_INJECTION_CAP};
use crate::agents::supervisor::SupervisedEvent;
use crate::broker::TurnContext;
use crate::db::models::{
    InterAgentMessage, InterAgentMessageStatus, MemorySource, MessageRole, TaskPriority, TaskStatus,
};
use crate::db::queries::{self, NewMemoryEntry, NewMessage, NewTask};
use crate::ipc::events::{
    AgentAssistantMessagePersistedPayload, AgentEventPayload, AgentIdentityUpdatedPayload,
    AgentInterAgentMessageDispatchedPayload, AgentInterAgentMessageFailedPayload,
    AgentMemoryAddedPayload, AgentStatusChangePayload, AgentTaskCreatedPayload,
    AgentTaskUpdatedPayload, EVENT_AGENT_ASSISTANT_MESSAGE_PERSISTED, EVENT_AGENT_EVENT,
    EVENT_AGENT_IDENTITY_UPDATED, EVENT_AGENT_INTER_AGENT_MESSAGE_DISPATCHED,
    EVENT_AGENT_INTER_AGENT_MESSAGE_FAILED, EVENT_AGENT_MEMORY_ADDED, EVENT_AGENT_STATUS_CHANGE,
    EVENT_AGENT_TASK_CREATED, EVENT_AGENT_TASK_UPDATED,
};

/// Inputs that define a single turn. The two public entrypoints
/// persist the user-role message themselves, then call `run_turn`
/// with the resulting metadata.
struct TurnRequest {
    agent_id: String,
    conversation_id: String,
    /// Text passed to the engine.
    user_text: String,
    /// The id of the human message that ultimately triggered this
    /// chain — propagated unchanged across hops so all hops share an
    /// origin. None when invoked outside any human turn (rare).
    origin_human_message_id: Option<String>,
    /// Depth of this turn: 0 for human-initiated, otherwise the
    /// originating `inter_agent_messages.depth`.
    parent_depth: i64,
    /// Originating inter-agent message; the runner marks this
    /// `acknowledged` (or `failed`) once the turn ends.
    originating_inter_agent_message_id: Option<String>,
}

/// Public entry point for a human-initiated turn. Persists the
/// human's message in the conversation log, then runs the turn.
pub async fn run_user_turn(
    ctx: TurnContext,
    agent_id: String,
    user_text: String,
) -> Result<(), String> {
    let conversation = queries::get_or_create_conversation_for_agent(&ctx.pool, &agent_id)
        .await
        .map_err(|e| format!("conversation resolve failed: {e}"))?;

    let user_message_id = uuid::Uuid::new_v4().to_string();
    let user_content = serde_json::json!({ "text": user_text }).to_string();
    queries::insert_message(
        &ctx.pool,
        NewMessage {
            id: &user_message_id,
            conversation_id: &conversation.id,
            role: MessageRole::User,
            content: &user_content,
            created_at: Utc::now(),
        },
    )
    .await
    .map_err(|e| format!("user message persist failed: {e}"))?;

    run_turn(
        ctx,
        TurnRequest {
            agent_id,
            conversation_id: conversation.id,
            user_text,
            origin_human_message_id: Some(user_message_id),
            parent_depth: 0,
            originating_inter_agent_message_id: None,
        },
    )
    .await
}

/// Public entry point for a broker-delivered inbound turn. Persists
/// a synthetic user-role message in the recipient's conversation log
/// with the `fromAgentId` annotation, then runs the turn.
pub async fn run_inbound_turn(
    ctx: TurnContext,
    agent_id: String,
    inbound: InterAgentMessage,
) -> Result<(), String> {
    let conversation = queries::get_or_create_conversation_for_agent(&ctx.pool, &agent_id)
        .await
        .map_err(|e| format!("conversation resolve failed: {e}"))?;

    let synthetic_message_id = uuid::Uuid::new_v4().to_string();
    let user_content = serde_json::json!({
        "text": inbound.content,
        "fromAgentId": inbound.from_agent_id,
        "interAgentMessageId": inbound.id,
    })
    .to_string();
    queries::insert_message(
        &ctx.pool,
        NewMessage {
            id: &synthetic_message_id,
            conversation_id: &conversation.id,
            role: MessageRole::User,
            content: &user_content,
            created_at: Utc::now(),
        },
    )
    .await
    .map_err(|e| format!("synthetic user message persist failed: {e}"))?;

    run_turn(
        ctx,
        TurnRequest {
            agent_id,
            conversation_id: conversation.id,
            user_text: inbound.content.clone(),
            origin_human_message_id: inbound.origin_human_message_id.clone(),
            parent_depth: inbound.depth,
            originating_inter_agent_message_id: Some(inbound.id),
        },
    )
    .await
}

/// Common turn body. Emits status changes, streams events through
/// supervisor + Tauri, persists messages on completion, extracts
/// pseudo-tools, and dispatches outbound `<send_to>`s through the
/// broker. Entrypoints have already persisted the user-role message
/// for this turn.
async fn run_turn(ctx: TurnContext, req: TurnRequest) -> Result<(), String> {
    let agent = queries::get_agent(&ctx.pool, &req.agent_id)
        .await
        .map_err(|e| format!("agent lookup failed: {e}"))?
        .ok_or_else(|| format!("agent {} not found", req.agent_id))?;

    queries::update_agent_status(&ctx.pool, &agent.id, "active")
        .await
        .ok();
    let _ = ctx.app.emit(
        EVENT_AGENT_STATUS_CHANGE,
        AgentStatusChangePayload {
            agent_id: agent.id.clone(),
            status: "active".to_string(),
        },
    );

    // Identity dirty flag: if set, build a <system_update> block. The
    // teammate roster (`other_agents`) doesn't appear in the update
    // block — it's only useful when the agent first reads its prompt.
    let prepend = if agent.identity_dirty != 0 {
        let memory =
            queries::recent_memory_entries(&ctx.pool, &agent.id, MEMORY_INJECTION_CAP as i64)
                .await
                .unwrap_or_default();
        let block = SystemPromptBuilder {
            agent_name: agent.name.clone(),
            working_dir: std::path::PathBuf::from(&agent.working_dir),
            soul: agent.soul.clone(),
            purpose: agent.purpose.clone(),
            memory,
            other_agents: Vec::<AgentSummary>::new(),
            // Update block is short and doesn't need the branch
            // addendum — branch state doesn't change between turns.
            branch: None,
        }
        .build_update_block();
        Some(block)
    } else {
        None
    };

    let stream = ctx
        .engine
        .send_message(&agent.id, &req.user_text, prepend.as_deref())
        .await
        .map_err(|e| e.user_facing())?;

    if prepend.is_some() {
        let _ = queries::set_identity_dirty(&ctx.pool, &agent.id, false).await;
        let _ = ctx.app.emit(
            EVENT_AGENT_IDENTITY_UPDATED,
            AgentIdentityUpdatedPayload {
                agent_id: agent.id.clone(),
                identity_dirty: false,
            },
        );
    }

    let mut stream = stream;
    let mut assistant_text = String::new();

    while let Some(event) = stream.next().await {
        let _ = ctx.app.emit(
            EVENT_AGENT_EVENT,
            AgentEventPayload {
                agent_id: agent.id.clone(),
                event: event.clone(),
            },
        );
        let _ = ctx.supervisor.sender().send(SupervisedEvent {
            agent_id: agent.id.clone(),
            event: event.clone(),
        });

        match &event {
            AgentEvent::SessionStarted { session_id } => {
                if let Err(e) =
                    queries::update_agent_session_id(&ctx.pool, &agent.id, session_id).await
                {
                    tracing::warn!(error = %e, "failed to persist session_id");
                }
            }
            AgentEvent::TextDelta { content } => {
                assistant_text.push_str(content);
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
                    &ctx.pool,
                    NewMessage {
                        id: &id,
                        conversation_id: &req.conversation_id,
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
                    &ctx.pool,
                    NewMessage {
                        id: &id,
                        conversation_id: &req.conversation_id,
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
                let extraction = extract::extract(&assistant_text);

                if !extraction.cleaned_text.is_empty() {
                    let content_json =
                        serde_json::json!({ "text": extraction.cleaned_text }).to_string();
                    let id = uuid::Uuid::new_v4().to_string();
                    match queries::insert_message(
                        &ctx.pool,
                        NewMessage {
                            id: &id,
                            conversation_id: &req.conversation_id,
                            role: MessageRole::Assistant,
                            content: &content_json,
                            created_at: Utc::now(),
                        },
                    )
                    .await
                    {
                        Ok(message) => {
                            let _ = ctx.app.emit(
                                EVENT_AGENT_ASSISTANT_MESSAGE_PERSISTED,
                                AgentAssistantMessagePersistedPayload {
                                    agent_id: agent.id.clone(),
                                    message,
                                },
                            );
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, "failed to persist assistant message");
                        }
                    }
                }

                for mem in extraction.memories {
                    if mem.truncated {
                        tracing::warn!(
                            agent_id = %agent.id,
                            "remember marker exceeded length cap; entry truncated to 8KB",
                        );
                    }
                    let mid = uuid::Uuid::new_v4().to_string();
                    match queries::insert_memory_entry(
                        &ctx.pool,
                        NewMemoryEntry {
                            id: &mid,
                            agent_id: &agent.id,
                            content: &mem.content,
                            category: None,
                            source: MemorySource::Agent,
                        },
                    )
                    .await
                    {
                        Ok(entry) => {
                            let _ = ctx.app.emit(
                                EVENT_AGENT_MEMORY_ADDED,
                                AgentMemoryAddedPayload {
                                    agent_id: agent.id.clone(),
                                    entry,
                                },
                            );
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, "failed to persist agent memory");
                        }
                    }
                }

                // Outbound `<send_to>` markers: route through the broker.
                // Per-message dispatch awaits the validation step but
                // not the recipient's full turn — the broker spawns the
                // recipient's drainer in its own task.
                for st in extraction.send_tos {
                    if st.truncated {
                        tracing::warn!(
                            agent_id = %agent.id,
                            recipient = %st.agent_name,
                            "send_to marker exceeded length cap; payload truncated to 8KB",
                        );
                    }
                    let broker = ctx.broker.clone();
                    match broker
                        .dispatch(
                            ctx.clone(),
                            agent.id.clone(),
                            st.agent_name.clone(),
                            st.content.clone(),
                            req.origin_human_message_id.clone(),
                            Some(req.parent_depth),
                        )
                        .await
                    {
                        Ok(row) => {
                            let _ = ctx.app.emit(
                                EVENT_AGENT_INTER_AGENT_MESSAGE_DISPATCHED,
                                AgentInterAgentMessageDispatchedPayload { message: row },
                            );
                        }
                        Err(e) => {
                            let _ = ctx.app.emit(
                                EVENT_AGENT_INTER_AGENT_MESSAGE_FAILED,
                                AgentInterAgentMessageFailedPayload {
                                    from_agent_id: agent.id.clone(),
                                    to_agent_name: st.agent_name.clone(),
                                    reason: e.tag().to_string(),
                                    detail: e.to_string(),
                                },
                            );
                            tracing::warn!(
                                error = %e,
                                "send_to dispatch failed",
                            );
                        }
                    }
                }

                // Phase 7: extracted `<task>` markers. Create or
                // update rows in the `tasks` table per ADR 0009.
                // Failures (unknown id on update, db error, etc.)
                // are logged but never crash the turn.
                for et in extraction.tasks {
                    if et.truncated {
                        tracing::warn!(
                            agent_id = %agent.id,
                            "task marker exceeded length cap; payload truncated to 8KB",
                        );
                    }
                    match et.action {
                        extract::TaskAction::Create => {
                            let title = et.title.unwrap_or_default();
                            let status_str = et.status.as_deref().unwrap_or("queued");
                            let Some(status) = TaskStatus::parse(status_str) else {
                                tracing::warn!(
                                    agent_id = %agent.id,
                                    status = status_str,
                                    "task create dropped: unknown status",
                                );
                                continue;
                            };
                            let priority = et
                                .priority
                                .as_deref()
                                .and_then(TaskPriority::parse)
                                .unwrap_or(TaskPriority::Normal);
                            let id = uuid::Uuid::new_v4().to_string();
                            match queries::insert_task(
                                &ctx.pool,
                                NewTask {
                                    id: &id,
                                    agent_id: &agent.id,
                                    title: &title,
                                    description: et.description.as_deref(),
                                    status,
                                    priority,
                                },
                            )
                            .await
                            {
                                Ok(task) => {
                                    let _ = ctx.app.emit(
                                        EVENT_AGENT_TASK_CREATED,
                                        AgentTaskCreatedPayload { task },
                                    );
                                }
                                Err(e) => {
                                    tracing::warn!(error = %e, "failed to insert task");
                                }
                            }
                        }
                        extract::TaskAction::Update => {
                            let Some(task_id) = et.id.as_deref() else {
                                continue;
                            };
                            let status = et.status.as_deref().and_then(TaskStatus::parse);
                            let priority = et.priority.as_deref().and_then(TaskPriority::parse);
                            match queries::update_task(
                                &ctx.pool,
                                task_id,
                                et.title.as_deref(),
                                et.description.as_deref(),
                                status,
                                priority,
                            )
                            .await
                            {
                                Ok(task) => {
                                    let _ = ctx.app.emit(
                                        EVENT_AGENT_TASK_UPDATED,
                                        AgentTaskUpdatedPayload { task },
                                    );
                                }
                                Err(e) => {
                                    tracing::warn!(
                                        error = %e,
                                        task_id = task_id,
                                        "task update dropped (unknown id?)",
                                    );
                                }
                            }
                        }
                    }
                }

                let _ = queries::update_agent_status(&ctx.pool, &agent.id, "idle").await;
                let _ = ctx.app.emit(
                    EVENT_AGENT_STATUS_CHANGE,
                    AgentStatusChangePayload {
                        agent_id: agent.id.clone(),
                        status: "idle".to_string(),
                    },
                );

                // For inbound turns, mark the originating inter-agent
                // message as acknowledged so the canvas flight
                // animation lands.
                if let Some(iam_id) = &req.originating_inter_agent_message_id {
                    let _ = queries::update_inter_agent_message_status(
                        &ctx.pool,
                        iam_id,
                        InterAgentMessageStatus::Acknowledged,
                    )
                    .await;
                    // Look up the now-acknowledged row and re-emit so
                    // the frontend in-flight set drops it from the
                    // canvas overlay.
                    if let Ok(rows) =
                        queries::list_inter_agent_messages_for_agent(&ctx.pool, &agent.id, 50).await
                    {
                        if let Some(row) = rows.into_iter().find(|r| r.id == *iam_id) {
                            let _ = ctx.app.emit(
                                crate::ipc::events::EVENT_AGENT_INTER_AGENT_MESSAGE_DISPATCHED,
                                crate::ipc::events::AgentInterAgentMessageDispatchedPayload {
                                    message: row,
                                },
                            );
                        }
                    }
                }
                break;
            }
            AgentEvent::Error { .. } => {
                let _ = queries::update_agent_status(&ctx.pool, &agent.id, "error").await;
                let _ = ctx.app.emit(
                    EVENT_AGENT_STATUS_CHANGE,
                    AgentStatusChangePayload {
                        agent_id: agent.id.clone(),
                        status: "error".to_string(),
                    },
                );
                if let Some(iam_id) = &req.originating_inter_agent_message_id {
                    let _ = queries::update_inter_agent_message_status(
                        &ctx.pool,
                        iam_id,
                        InterAgentMessageStatus::Failed,
                    )
                    .await;
                }
                break;
            }
            _ => {}
        }
    }

    Ok(())
}
