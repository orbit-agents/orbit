//! Inter-agent message broker.
//!
//! Every agent-to-agent message routes through this module. The broker
//! is the single point of transparency, auditability, rate-limiting,
//! and replay for inter-agent traffic — see CLAUDE.md rule #2.
//!
//! Shape (Phase 4):
//!
//! - Per-agent inbox queue (`VecDeque` behind a `Mutex`) so concurrent
//!   senders to the same recipient serialize without trampling on a
//!   half-finished turn.
//! - `dispatch()` validates the recipient (resolve by name; reject
//!   self-send and depth > MAX_DEPTH), writes a `pending` audit row,
//!   enqueues, and — if the recipient isn't already draining — spawns
//!   a per-recipient drainer task that pops one message at a time and
//!   runs the recipient's turn via the engine.
//! - The recipient's turn handler (in `agents::turn`) calls back into
//!   `dispatch()` for any `<send_to>` markers the recipient emits,
//!   propagating the loop chain via `origin_human_message_id` + an
//!   incremented `depth`.

use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use chrono::Utc;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::agents::engine::{AgentEngine, AgentId};
use crate::agents::supervisor::SharedSupervisor;
use crate::db::models::{InterAgentMessage, InterAgentMessageStatus};
use crate::db::queries::{self, NewInterAgentMessage};
use crate::ipc::events::{
    AgentInterAgentMessageDispatchedPayload, EVENT_AGENT_INTER_AGENT_MESSAGE_DISPATCHED,
};

/// Maximum chain depth before the broker rejects. See ADR 0006.
pub const MAX_DEPTH: i64 = 8;

/// Reasons a dispatch can fail. The variant name doubles as a short
/// machine-readable tag we'll surface to the sender on its next turn.
#[derive(Debug, thiserror::Error)]
pub enum BrokerError {
    #[error("recipient agent `{0}` is not running")]
    UnknownRecipient(String),
    #[error("agents cannot send messages to themselves")]
    SelfSend,
    #[error("agent-chain depth exceeded the limit of {MAX_DEPTH}")]
    DepthExceeded,
    #[error("database error: {0}")]
    Db(#[from] crate::db::DbError),
}

impl BrokerError {
    /// Short tag used for the `failed` audit row reason and surfaced to
    /// the sender. Stable across renames.
    pub fn tag(&self) -> &'static str {
        match self {
            Self::UnknownRecipient(_) => "unknown_recipient",
            Self::SelfSend => "self_send",
            Self::DepthExceeded => "depth_exceeded",
            Self::Db(_) => "db_error",
        }
    }
}

/// One queued turn for an agent. Both the human-facing
/// `agent_send_message` command and the broker's `dispatch` path
/// land on the same per-agent FIFO so concurrent human + broker
/// activity to the same agent serializes cleanly instead of
/// trampling on each other's `turn_sender` slot in the engine.
#[derive(Debug)]
enum QueuedTurn {
    Inbound(InterAgentMessage),
    User { content: String },
}

#[derive(Default)]
struct InboxState {
    queue: VecDeque<QueuedTurn>,
    processing: bool,
}

pub struct Broker {
    pool: SqlitePool,
    inboxes: Mutex<HashMap<AgentId, Arc<Mutex<InboxState>>>>,
}

/// Bag of handles a recipient's turn handler needs. Held by AppState
/// and threaded through the broker so it can spawn recipient turns
/// without re-resolving Tauri state.
#[derive(Clone)]
pub struct TurnContext {
    pub pool: SqlitePool,
    pub engine: Arc<dyn AgentEngine>,
    pub supervisor: SharedSupervisor,
    pub app: AppHandle,
    pub broker: Arc<Broker>,
}

impl Broker {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            pool,
            inboxes: Mutex::new(HashMap::new()),
        }
    }

    async fn inbox_for(&self, agent_id: &AgentId) -> Arc<Mutex<InboxState>> {
        let mut map = self.inboxes.lock().await;
        map.entry(agent_id.clone())
            .or_insert_with(|| Arc::new(Mutex::new(InboxState::default())))
            .clone()
    }

    /// Validate, write audit row, enqueue, and (if not already draining)
    /// kick off a drainer task for the recipient.
    ///
    /// `sender_depth` is the depth of the inter-agent message that
    /// triggered the sender's current turn — `None` for human-initiated
    /// turns. The dispatched message's depth is `sender_depth + 1` (or
    /// 1 when the sender is acting on a human turn).
    /// Returned as `Pin<Box<dyn Future + Send>>` so the recursive
    /// async path (`run_turn` → `dispatch` → spawned `drain_inbox` →
    /// `run_inbound_turn` → `run_turn` → `dispatch`) doesn't trip
    /// rustc's Send-bound check on auto-traits.
    pub fn dispatch(
        self: Arc<Self>,
        ctx: TurnContext,
        from_agent_id: AgentId,
        to_agent_name: String,
        content: String,
        origin_human_message_id: Option<String>,
        sender_depth: Option<i64>,
    ) -> Pin<Box<dyn Future<Output = Result<InterAgentMessage, BrokerError>> + Send>> {
        Box::pin(async move {
            // Resolve recipient. Names are case-insensitive but unique
            // per Phase 2's spawn dialog. Capture the canonical id and
            // drop the borrow before any await.
            let recipient_id = {
                let agents = queries::list_agents(&self.pool).await?;
                agents
                    .iter()
                    .find(|a| a.name.eq_ignore_ascii_case(&to_agent_name))
                    .map(|a| a.id.clone())
                    .ok_or_else(|| BrokerError::UnknownRecipient(to_agent_name.clone()))?
            };

            if recipient_id == from_agent_id {
                self.write_failed(
                    &from_agent_id,
                    &recipient_id,
                    &content,
                    origin_human_message_id.as_deref(),
                )
                .await;
                return Err(BrokerError::SelfSend);
            }

            let new_depth = sender_depth.unwrap_or(0) + 1;
            if new_depth > MAX_DEPTH {
                self.write_failed(
                    &from_agent_id,
                    &recipient_id,
                    &content,
                    origin_human_message_id.as_deref(),
                )
                .await;
                return Err(BrokerError::DepthExceeded);
            }

            let id = uuid::Uuid::new_v4().to_string();
            let row = queries::insert_inter_agent_message(
                &self.pool,
                NewInterAgentMessage {
                    id: &id,
                    from_agent_id: &from_agent_id,
                    to_agent_id: &recipient_id,
                    content: &content,
                    origin_human_message_id: origin_human_message_id.as_deref(),
                    depth: new_depth,
                },
            )
            .await?;

            // Enqueue, then (maybe) spawn the drainer.
            let inbox = self.inbox_for(&recipient_id).await;
            let need_to_spawn = {
                let mut state = inbox.lock().await;
                state.queue.push_back(QueuedTurn::Inbound(row.clone()));
                if state.processing {
                    false
                } else {
                    state.processing = true;
                    true
                }
            };

            if need_to_spawn {
                let broker = Arc::clone(&self);
                let ctx_for_task = ctx.clone();
                let recipient_for_task = recipient_id.clone();
                tokio::spawn(async move {
                    broker.drain_inbox(ctx_for_task, recipient_for_task).await;
                });
            }

            Ok(row)
        })
    }

    /// Phase 5 fix: route human-initiated turns through the same
    /// per-agent queue the broker uses for inbound messages. This
    /// keeps engine.send_message from being called concurrently
    /// against the same agent (which would race the `turn_sender`
    /// slot and orphan one of the streams).
    pub async fn enqueue_user_turn(
        self: &Arc<Self>,
        ctx: TurnContext,
        agent_id: AgentId,
        content: String,
    ) {
        let inbox = self.inbox_for(&agent_id).await;
        let need_to_spawn = {
            let mut state = inbox.lock().await;
            state.queue.push_back(QueuedTurn::User { content });
            if state.processing {
                false
            } else {
                state.processing = true;
                true
            }
        };
        if need_to_spawn {
            let broker = Arc::clone(self);
            tokio::spawn(async move {
                broker.drain_inbox(ctx, agent_id).await;
            });
        }
    }

    /// Drain the recipient's inbox one message at a time. Each
    /// iteration pops, marks `delivered`, runs the recipient's turn
    /// (which marks `acknowledged` on `TurnComplete`), and loops.
    async fn drain_inbox(self: Arc<Self>, ctx: TurnContext, agent_id: AgentId) {
        let inbox = self.inbox_for(&agent_id).await;
        loop {
            let next = {
                let mut state = inbox.lock().await;
                if let Some(item) = state.queue.pop_front() {
                    Some(item)
                } else {
                    state.processing = false;
                    None
                }
            };
            let Some(item) = next else {
                return;
            };

            match item {
                QueuedTurn::Inbound(msg) => {
                    if let Err(e) = queries::update_inter_agent_message_status(
                        &ctx.pool,
                        &msg.id,
                        InterAgentMessageStatus::Delivered,
                    )
                    .await
                    {
                        tracing::warn!(error = %e, "failed to mark inter-agent message delivered");
                    }
                    // Re-emit so the frontend in-flight set transitions
                    // pending → delivered for the canvas overlay.
                    let mut delivered_row = msg.clone();
                    delivered_row.status = InterAgentMessageStatus::Delivered.as_str().to_string();
                    delivered_row.delivered_at = Some(chrono::Utc::now());
                    let _ = ctx.app.emit(
                        EVENT_AGENT_INTER_AGENT_MESSAGE_DISPATCHED,
                        AgentInterAgentMessageDispatchedPayload {
                            message: delivered_row,
                        },
                    );

                    if let Err(e) =
                        crate::agents::turn::run_inbound_turn(ctx.clone(), agent_id.clone(), msg)
                            .await
                    {
                        tracing::warn!(error = %e, "inbound turn handler failed");
                    }
                }
                QueuedTurn::User { content } => {
                    if let Err(e) =
                        crate::agents::turn::run_user_turn(ctx.clone(), agent_id.clone(), content)
                            .await
                    {
                        tracing::warn!(error = %e, "user turn handler failed");
                    }
                }
            }
        }
    }

    /// Write a `failed` audit row for invariants we reject before any
    /// queue activity (self-send, depth, unknown recipient).
    async fn write_failed(
        &self,
        from_agent_id: &AgentId,
        to_agent_id: &AgentId,
        content: &str,
        origin_human_message_id: Option<&str>,
    ) {
        let id = uuid::Uuid::new_v4().to_string();
        let _ = sqlx::query(
            "INSERT INTO inter_agent_messages
                (id, from_agent_id, to_agent_id, content, origin_human_message_id,
                 depth, status, created_at, delivered_at)
             VALUES (?, ?, ?, ?, ?, ?, 'failed', ?, NULL)",
        )
        .bind(&id)
        .bind(from_agent_id)
        .bind(to_agent_id)
        .bind(content)
        .bind(origin_human_message_id)
        .bind(0_i64)
        .bind(Utc::now())
        .execute(&self.pool)
        .await;
    }
}

pub type SharedBroker = Arc<Broker>;
