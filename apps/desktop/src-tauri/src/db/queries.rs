//! CRUD helpers for Phase 1. Query strings are kept short and typed at the
//! call site with `query_as`. Compile-time checked queries (`query!`) are a
//! future change once the schema stabilizes.

use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use super::models::{
    Agent, Conversation, GroupMessage, GroupThread, GroupThreadMember, InterAgentMessage,
    InterAgentMessageStatus, McpServer, MemoryEntry, MemorySource, Message, MessageRole,
    StickyNote, Task, TaskPriority, TaskStatus, Team,
};
use super::DbError;

pub struct NewAgent<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub emoji: &'a str,
    pub color: &'a str,
    pub working_dir: &'a str,
    pub model_override: Option<&'a str>,
    pub position_x: f64,
    pub position_y: f64,
}

pub async fn insert_agent(pool: &SqlitePool, new: NewAgent<'_>) -> Result<Agent, DbError> {
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO agents (id, name, emoji, color, working_dir, model_override, status,
                             position_x, position_y, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?, ?)",
    )
    .bind(new.id)
    .bind(new.name)
    .bind(new.emoji)
    .bind(new.color)
    .bind(new.working_dir)
    .bind(new.model_override)
    .bind(new.position_x)
    .bind(new.position_y)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;

    get_agent(pool, new.id)
        .await?
        .ok_or_else(|| DbError::Sqlx(sqlx::Error::RowNotFound))
}

pub async fn update_agent_position(
    pool: &SqlitePool,
    id: &str,
    x: f64,
    y: f64,
) -> Result<(), DbError> {
    sqlx::query("UPDATE agents SET position_x = ?, position_y = ?, updated_at = ? WHERE id = ?")
        .bind(x)
        .bind(y)
        .bind(Utc::now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_agent_name(pool: &SqlitePool, id: &str, name: &str) -> Result<(), DbError> {
    sqlx::query("UPDATE agents SET name = ?, updated_at = ? WHERE id = ?")
        .bind(name)
        .bind(Utc::now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn count_agents(pool: &SqlitePool) -> Result<i64, DbError> {
    let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM agents")
        .fetch_one(pool)
        .await?;
    Ok(n)
}

pub async fn get_agent(pool: &SqlitePool, id: &str) -> Result<Option<Agent>, DbError> {
    let row = sqlx::query_as::<_, Agent>("SELECT * FROM agents WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row)
}

pub async fn list_agents(pool: &SqlitePool) -> Result<Vec<Agent>, DbError> {
    let rows = sqlx::query_as::<_, Agent>("SELECT * FROM agents ORDER BY created_at ASC")
        .fetch_all(pool)
        .await?;
    Ok(rows)
}

pub async fn update_agent_session_id(
    pool: &SqlitePool,
    id: &str,
    session_id: &str,
) -> Result<(), DbError> {
    sqlx::query("UPDATE agents SET session_id = ?, updated_at = ? WHERE id = ?")
        .bind(session_id)
        .bind(Utc::now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_agent_status(pool: &SqlitePool, id: &str, status: &str) -> Result<(), DbError> {
    sqlx::query("UPDATE agents SET status = ?, updated_at = ? WHERE id = ?")
        .bind(status)
        .bind(Utc::now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_agent(pool: &SqlitePool, id: &str) -> Result<(), DbError> {
    sqlx::query("DELETE FROM agents WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn insert_conversation(
    pool: &SqlitePool,
    id: &str,
    agent_id: &str,
) -> Result<Conversation, DbError> {
    let now = Utc::now();
    sqlx::query("INSERT INTO conversations (id, agent_id, created_at) VALUES (?, ?, ?)")
        .bind(id)
        .bind(agent_id)
        .bind(now)
        .execute(pool)
        .await?;
    Ok(Conversation {
        id: id.to_string(),
        agent_id: agent_id.to_string(),
        created_at: now,
    })
}

pub async fn get_or_create_conversation_for_agent(
    pool: &SqlitePool,
    agent_id: &str,
) -> Result<Conversation, DbError> {
    if let Some(existing) = sqlx::query_as::<_, Conversation>(
        "SELECT * FROM conversations WHERE agent_id = ? ORDER BY created_at ASC LIMIT 1",
    )
    .bind(agent_id)
    .fetch_optional(pool)
    .await?
    {
        return Ok(existing);
    }

    let id = uuid::Uuid::new_v4().to_string();
    insert_conversation(pool, &id, agent_id).await
}

pub struct NewMessage<'a> {
    pub id: &'a str,
    pub conversation_id: &'a str,
    pub role: MessageRole,
    pub content: &'a str,
    pub created_at: DateTime<Utc>,
}

pub async fn insert_message(pool: &SqlitePool, new: NewMessage<'_>) -> Result<Message, DbError> {
    sqlx::query(
        "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(new.id)
    .bind(new.conversation_id)
    .bind(new.role.as_str())
    .bind(new.content)
    .bind(new.created_at)
    .execute(pool)
    .await?;

    Ok(Message {
        id: new.id.to_string(),
        conversation_id: new.conversation_id.to_string(),
        role: new.role.as_str().to_string(),
        content: new.content.to_string(),
        created_at: new.created_at,
    })
}

// ─── Phase 3: identity ────────────────────────────────────────────────────

/// Persist new soul/purpose values and mark the agent's identity as dirty
/// so the supervisor injects them on the next user turn. Either argument
/// may be `None` to leave that field untouched.
pub async fn update_agent_identity(
    pool: &SqlitePool,
    id: &str,
    soul: Option<&str>,
    purpose: Option<&str>,
) -> Result<(), DbError> {
    // Two narrow updates rather than one wide one — avoids overwriting an
    // unrelated field with NULL when the caller only wants to set one.
    let now = Utc::now();
    if let Some(s) = soul {
        sqlx::query("UPDATE agents SET soul = ?, identity_dirty = 1, updated_at = ? WHERE id = ?")
            .bind(s)
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(p) = purpose {
        sqlx::query(
            "UPDATE agents SET purpose = ?, identity_dirty = 1, updated_at = ? WHERE id = ?",
        )
        .bind(p)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn set_identity_dirty(pool: &SqlitePool, id: &str, dirty: bool) -> Result<(), DbError> {
    sqlx::query("UPDATE agents SET identity_dirty = ?, updated_at = ? WHERE id = ?")
        .bind(if dirty { 1_i64 } else { 0_i64 })
        .bind(Utc::now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ─── Phase 3: memory ──────────────────────────────────────────────────────

pub struct NewMemoryEntry<'a> {
    pub id: &'a str,
    pub agent_id: &'a str,
    pub content: &'a str,
    pub category: Option<&'a str>,
    pub source: MemorySource,
}

pub async fn insert_memory_entry(
    pool: &SqlitePool,
    new: NewMemoryEntry<'_>,
) -> Result<MemoryEntry, DbError> {
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO memory_entries (id, agent_id, content, category, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(new.id)
    .bind(new.agent_id)
    .bind(new.content)
    .bind(new.category)
    .bind(new.source.as_str())
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;

    // The insert itself stamps identity_dirty so the next turn picks up the
    // new memory without an explicit identity update.
    set_identity_dirty(pool, new.agent_id, true).await?;

    Ok(MemoryEntry {
        id: new.id.to_string(),
        agent_id: new.agent_id.to_string(),
        content: new.content.to_string(),
        category: new.category.map(|s| s.to_string()),
        source: new.source.as_str().to_string(),
        created_at: now,
        updated_at: now,
    })
}

pub async fn update_memory_entry(
    pool: &SqlitePool,
    id: &str,
    content: &str,
) -> Result<MemoryEntry, DbError> {
    let now = Utc::now();
    sqlx::query("UPDATE memory_entries SET content = ?, updated_at = ? WHERE id = ?")
        .bind(content)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    let row = sqlx::query_as::<_, MemoryEntry>("SELECT * FROM memory_entries WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| DbError::Sqlx(sqlx::Error::RowNotFound))?;
    set_identity_dirty(pool, &row.agent_id, true).await?;
    Ok(row)
}

pub async fn delete_memory_entry(pool: &SqlitePool, id: &str) -> Result<(), DbError> {
    // Capture the agent id before deleting so we can flip the dirty flag.
    let agent_id: Option<(String,)> =
        sqlx::query_as("SELECT agent_id FROM memory_entries WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    sqlx::query("DELETE FROM memory_entries WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    if let Some((aid,)) = agent_id {
        set_identity_dirty(pool, &aid, true).await?;
    }
    Ok(())
}

/// List memory entries for an agent, newest first. If `search` is supplied,
/// case-insensitive substring filter on `content`.
pub async fn list_memory_entries(
    pool: &SqlitePool,
    agent_id: &str,
    search: Option<&str>,
) -> Result<Vec<MemoryEntry>, DbError> {
    if let Some(q) = search.filter(|s| !s.trim().is_empty()) {
        let pattern = format!("%{}%", q.to_lowercase());
        let rows = sqlx::query_as::<_, MemoryEntry>(
            "SELECT * FROM memory_entries
             WHERE agent_id = ? AND lower(content) LIKE ?
             ORDER BY created_at DESC",
        )
        .bind(agent_id)
        .bind(pattern)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    } else {
        let rows = sqlx::query_as::<_, MemoryEntry>(
            "SELECT * FROM memory_entries
             WHERE agent_id = ?
             ORDER BY created_at DESC",
        )
        .bind(agent_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }
}

/// The N most recent memory entries (used by the system prompt builder).
pub async fn recent_memory_entries(
    pool: &SqlitePool,
    agent_id: &str,
    limit: i64,
) -> Result<Vec<MemoryEntry>, DbError> {
    let rows = sqlx::query_as::<_, MemoryEntry>(
        "SELECT * FROM memory_entries
         WHERE agent_id = ?
         ORDER BY created_at DESC
         LIMIT ?",
    )
    .bind(agent_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ─── Phase 4: inter-agent messages ────────────────────────────────────────

pub struct NewInterAgentMessage<'a> {
    pub id: &'a str,
    pub from_agent_id: &'a str,
    pub to_agent_id: &'a str,
    pub content: &'a str,
    pub origin_human_message_id: Option<&'a str>,
    pub depth: i64,
}

/// Insert a new inter-agent message in `pending` state. The broker
/// flips the status to `delivered` (or `failed`) once dispatch
/// happens, with `mark_inter_agent_message_delivered` /
/// `mark_inter_agent_message_failed`.
pub async fn insert_inter_agent_message(
    pool: &SqlitePool,
    new: NewInterAgentMessage<'_>,
) -> Result<InterAgentMessage, DbError> {
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO inter_agent_messages
            (id, from_agent_id, to_agent_id, content, origin_human_message_id,
             depth, status, created_at, delivered_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL)",
    )
    .bind(new.id)
    .bind(new.from_agent_id)
    .bind(new.to_agent_id)
    .bind(new.content)
    .bind(new.origin_human_message_id)
    .bind(new.depth)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(InterAgentMessage {
        id: new.id.to_string(),
        from_agent_id: new.from_agent_id.to_string(),
        to_agent_id: new.to_agent_id.to_string(),
        content: new.content.to_string(),
        origin_human_message_id: new.origin_human_message_id.map(|s| s.to_string()),
        depth: new.depth,
        status: InterAgentMessageStatus::Pending.as_str().to_string(),
        created_at: now,
        delivered_at: None,
    })
}

pub async fn update_inter_agent_message_status(
    pool: &SqlitePool,
    id: &str,
    status: InterAgentMessageStatus,
) -> Result<(), DbError> {
    let now = Utc::now();
    let delivered = matches!(
        status,
        InterAgentMessageStatus::Delivered | InterAgentMessageStatus::Acknowledged
    );
    if delivered {
        sqlx::query("UPDATE inter_agent_messages SET status = ?, delivered_at = ? WHERE id = ?")
            .bind(status.as_str())
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
    } else {
        sqlx::query("UPDATE inter_agent_messages SET status = ? WHERE id = ?")
            .bind(status.as_str())
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// All inter-agent messages either to or from the given agent, newest first.
pub async fn list_inter_agent_messages_for_agent(
    pool: &SqlitePool,
    agent_id: &str,
    limit: i64,
) -> Result<Vec<InterAgentMessage>, DbError> {
    let rows = sqlx::query_as::<_, InterAgentMessage>(
        "SELECT * FROM inter_agent_messages
         WHERE from_agent_id = ? OR to_agent_id = ?
         ORDER BY created_at DESC
         LIMIT ?",
    )
    .bind(agent_id)
    .bind(agent_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Audit log across the whole system. Useful for debugging and the
/// future Phase 7 status report view.
pub async fn list_inter_agent_audit_log(
    pool: &SqlitePool,
    limit: i64,
) -> Result<Vec<InterAgentMessage>, DbError> {
    let rows = sqlx::query_as::<_, InterAgentMessage>(
        "SELECT * FROM inter_agent_messages ORDER BY created_at DESC LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ─── Phase 8: group threads ───────────────────────────────────────────────

pub struct NewGroupThread<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub color: &'a str,
}

pub async fn insert_group_thread(
    pool: &SqlitePool,
    new: NewGroupThread<'_>,
) -> Result<GroupThread, DbError> {
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO group_threads (id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(new.id)
    .bind(new.name)
    .bind(new.color)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;
    get_group_thread(pool, new.id)
        .await?
        .ok_or_else(|| DbError::Sqlx(sqlx::Error::RowNotFound))
}

pub async fn get_group_thread(pool: &SqlitePool, id: &str) -> Result<Option<GroupThread>, DbError> {
    let row = sqlx::query_as::<_, GroupThread>("SELECT * FROM group_threads WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row)
}

pub async fn list_group_threads(pool: &SqlitePool) -> Result<Vec<GroupThread>, DbError> {
    let rows =
        sqlx::query_as::<_, GroupThread>("SELECT * FROM group_threads ORDER BY created_at ASC")
            .fetch_all(pool)
            .await?;
    Ok(rows)
}

pub async fn delete_group_thread(pool: &SqlitePool, id: &str) -> Result<(), DbError> {
    sqlx::query("DELETE FROM group_threads WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn add_group_member(
    pool: &SqlitePool,
    thread_id: &str,
    agent_id: &str,
) -> Result<(), DbError> {
    sqlx::query(
        "INSERT OR IGNORE INTO group_thread_members (thread_id, agent_id, added_at)
         VALUES (?, ?, ?)",
    )
    .bind(thread_id)
    .bind(agent_id)
    .bind(Utc::now())
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_group_member(
    pool: &SqlitePool,
    thread_id: &str,
    agent_id: &str,
) -> Result<(), DbError> {
    sqlx::query("DELETE FROM group_thread_members WHERE thread_id = ? AND agent_id = ?")
        .bind(thread_id)
        .bind(agent_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_group_members(
    pool: &SqlitePool,
    thread_id: &str,
) -> Result<Vec<GroupThreadMember>, DbError> {
    let rows = sqlx::query_as::<_, GroupThreadMember>(
        "SELECT * FROM group_thread_members WHERE thread_id = ? ORDER BY added_at ASC",
    )
    .bind(thread_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub struct NewGroupMessage<'a> {
    pub id: &'a str,
    pub thread_id: &'a str,
    pub sender_kind: &'a str,
    pub sender_agent_id: Option<&'a str>,
    pub content: &'a str,
}

pub async fn insert_group_message(
    pool: &SqlitePool,
    new: NewGroupMessage<'_>,
) -> Result<GroupMessage, DbError> {
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO group_messages (id, thread_id, sender_kind, sender_agent_id, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(new.id)
    .bind(new.thread_id)
    .bind(new.sender_kind)
    .bind(new.sender_agent_id)
    .bind(new.content)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(GroupMessage {
        id: new.id.to_string(),
        thread_id: new.thread_id.to_string(),
        sender_kind: new.sender_kind.to_string(),
        sender_agent_id: new.sender_agent_id.map(|s| s.to_string()),
        content: new.content.to_string(),
        created_at: now,
    })
}

pub async fn list_group_messages(
    pool: &SqlitePool,
    thread_id: &str,
    limit: i64,
) -> Result<Vec<GroupMessage>, DbError> {
    let rows = sqlx::query_as::<_, GroupMessage>(
        "SELECT * FROM group_messages
         WHERE thread_id = ?
         ORDER BY created_at ASC
         LIMIT ?",
    )
    .bind(thread_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ─── Phase 8: MCP servers ─────────────────────────────────────────────────

pub struct NewMcpServer<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub transport: &'a str,
    pub command: Option<&'a str>,
    pub args_json: &'a str,
    pub env_json: &'a str,
    pub url: Option<&'a str>,
    pub is_default: bool,
}

pub async fn insert_mcp_server(
    pool: &SqlitePool,
    new: NewMcpServer<'_>,
) -> Result<McpServer, DbError> {
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO mcp_servers
            (id, name, transport, command, args_json, env_json, url,
             is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(new.id)
    .bind(new.name)
    .bind(new.transport)
    .bind(new.command)
    .bind(new.args_json)
    .bind(new.env_json)
    .bind(new.url)
    .bind(if new.is_default { 1_i64 } else { 0_i64 })
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;
    get_mcp_server(pool, new.id)
        .await?
        .ok_or_else(|| DbError::Sqlx(sqlx::Error::RowNotFound))
}

pub async fn get_mcp_server(pool: &SqlitePool, id: &str) -> Result<Option<McpServer>, DbError> {
    let row = sqlx::query_as::<_, McpServer>("SELECT * FROM mcp_servers WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row)
}

pub async fn list_mcp_servers(pool: &SqlitePool) -> Result<Vec<McpServer>, DbError> {
    let rows = sqlx::query_as::<_, McpServer>("SELECT * FROM mcp_servers ORDER BY name ASC")
        .fetch_all(pool)
        .await?;
    Ok(rows)
}

pub async fn list_default_mcp_servers(pool: &SqlitePool) -> Result<Vec<McpServer>, DbError> {
    let rows = sqlx::query_as::<_, McpServer>(
        "SELECT * FROM mcp_servers WHERE is_default = 1 ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Updatable fields on an `McpServer`. Each `Option` left `None`
/// keeps the existing value. Bundled into a struct so the function
/// signature stays small as MCP gains more knobs.
#[derive(Debug, Default)]
pub struct McpServerUpdate<'a> {
    pub name: Option<&'a str>,
    pub transport: Option<&'a str>,
    pub command: Option<&'a str>,
    pub args_json: Option<&'a str>,
    pub env_json: Option<&'a str>,
    pub url: Option<&'a str>,
    pub is_default: Option<bool>,
}

pub async fn update_mcp_server(
    pool: &SqlitePool,
    id: &str,
    update: McpServerUpdate<'_>,
) -> Result<McpServer, DbError> {
    let McpServerUpdate {
        name,
        transport,
        command,
        args_json,
        env_json,
        url,
        is_default,
    } = update;
    let now = Utc::now();
    let bumps: Vec<(&str, String)> = [
        name.map(|v| ("name", v.to_string())),
        transport.map(|v| ("transport", v.to_string())),
        command.map(|v| ("command", v.to_string())),
        args_json.map(|v| ("args_json", v.to_string())),
        env_json.map(|v| ("env_json", v.to_string())),
        url.map(|v| ("url", v.to_string())),
        is_default.map(|v| ("is_default", if v { "1" } else { "0" }.to_string())),
    ]
    .into_iter()
    .flatten()
    .collect();

    for (col, val) in bumps {
        let sql = format!("UPDATE mcp_servers SET {col} = ?, updated_at = ? WHERE id = ?");
        sqlx::query(&sql)
            .bind(val)
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
    }
    get_mcp_server(pool, id)
        .await?
        .ok_or_else(|| DbError::Sqlx(sqlx::Error::RowNotFound))
}

pub async fn delete_mcp_server(pool: &SqlitePool, id: &str) -> Result<(), DbError> {
    sqlx::query("DELETE FROM mcp_servers WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ─── Phase 7: tasks ───────────────────────────────────────────────────────

pub struct NewTask<'a> {
    pub id: &'a str,
    pub agent_id: &'a str,
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub status: TaskStatus,
    pub priority: TaskPriority,
}

pub async fn insert_task(pool: &SqlitePool, new: NewTask<'_>) -> Result<Task, DbError> {
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO tasks (id, agent_id, title, description, status, priority,
                            created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
    )
    .bind(new.id)
    .bind(new.agent_id)
    .bind(new.title)
    .bind(new.description)
    .bind(new.status.as_str())
    .bind(new.priority.as_str())
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;
    get_task(pool, new.id)
        .await?
        .ok_or_else(|| DbError::Sqlx(sqlx::Error::RowNotFound))
}

pub async fn get_task(pool: &SqlitePool, id: &str) -> Result<Option<Task>, DbError> {
    let row = sqlx::query_as::<_, Task>("SELECT * FROM tasks WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row)
}

pub async fn list_tasks_for_agent(pool: &SqlitePool, agent_id: &str) -> Result<Vec<Task>, DbError> {
    let rows = sqlx::query_as::<_, Task>(
        "SELECT * FROM tasks WHERE agent_id = ? ORDER BY created_at DESC",
    )
    .bind(agent_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn list_all_tasks(pool: &SqlitePool, limit: i64) -> Result<Vec<Task>, DbError> {
    let rows = sqlx::query_as::<_, Task>("SELECT * FROM tasks ORDER BY updated_at DESC LIMIT ?")
        .bind(limit)
        .fetch_all(pool)
        .await?;
    Ok(rows)
}

/// Update any subset of a task's mutable fields. Each `Option` left
/// `None` keeps the existing value. `status = Done` automatically
/// stamps `completed_at`; any non-Done status clears it.
pub async fn update_task(
    pool: &SqlitePool,
    id: &str,
    title: Option<&str>,
    description: Option<&str>,
    status: Option<TaskStatus>,
    priority: Option<TaskPriority>,
) -> Result<Task, DbError> {
    let now = Utc::now();
    if let Some(t) = title {
        sqlx::query("UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?")
            .bind(t)
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(d) = description {
        sqlx::query("UPDATE tasks SET description = ?, updated_at = ? WHERE id = ?")
            .bind(d)
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(s) = status {
        let completed_at = if matches!(s, TaskStatus::Done) {
            Some(now)
        } else {
            None
        };
        sqlx::query("UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?")
            .bind(s.as_str())
            .bind(completed_at)
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(p) = priority {
        sqlx::query("UPDATE tasks SET priority = ?, updated_at = ? WHERE id = ?")
            .bind(p.as_str())
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
    }
    get_task(pool, id)
        .await?
        .ok_or_else(|| DbError::Sqlx(sqlx::Error::RowNotFound))
}

pub async fn delete_task(pool: &SqlitePool, id: &str) -> Result<(), DbError> {
    sqlx::query("DELETE FROM tasks WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ─── Phase 7: sticky notes ────────────────────────────────────────────────

pub struct NewStickyNote<'a> {
    pub id: &'a str,
    pub content: &'a str,
    pub position_x: f64,
    pub position_y: f64,
    pub color: &'a str,
}

pub async fn insert_sticky_note(
    pool: &SqlitePool,
    new: NewStickyNote<'_>,
) -> Result<StickyNote, DbError> {
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO sticky_notes (id, content, position_x, position_y, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(new.id)
    .bind(new.content)
    .bind(new.position_x)
    .bind(new.position_y)
    .bind(new.color)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;
    get_sticky_note(pool, new.id)
        .await?
        .ok_or_else(|| DbError::Sqlx(sqlx::Error::RowNotFound))
}

pub async fn get_sticky_note(pool: &SqlitePool, id: &str) -> Result<Option<StickyNote>, DbError> {
    let row = sqlx::query_as::<_, StickyNote>("SELECT * FROM sticky_notes WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row)
}

pub async fn list_sticky_notes(pool: &SqlitePool) -> Result<Vec<StickyNote>, DbError> {
    let rows =
        sqlx::query_as::<_, StickyNote>("SELECT * FROM sticky_notes ORDER BY created_at ASC")
            .fetch_all(pool)
            .await?;
    Ok(rows)
}

pub async fn update_sticky_note(
    pool: &SqlitePool,
    id: &str,
    content: Option<&str>,
    position: Option<(f64, f64)>,
    color: Option<&str>,
) -> Result<StickyNote, DbError> {
    let now = Utc::now();
    if let Some(c) = content {
        sqlx::query("UPDATE sticky_notes SET content = ?, updated_at = ? WHERE id = ?")
            .bind(c)
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some((x, y)) = position {
        sqlx::query(
            "UPDATE sticky_notes SET position_x = ?, position_y = ?, updated_at = ? WHERE id = ?",
        )
        .bind(x)
        .bind(y)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    }
    if let Some(c) = color {
        sqlx::query("UPDATE sticky_notes SET color = ?, updated_at = ? WHERE id = ?")
            .bind(c)
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
    }
    get_sticky_note(pool, id)
        .await?
        .ok_or_else(|| DbError::Sqlx(sqlx::Error::RowNotFound))
}

pub async fn delete_sticky_note(pool: &SqlitePool, id: &str) -> Result<(), DbError> {
    sqlx::query("DELETE FROM sticky_notes WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ─── Phase 6: git isolation ───────────────────────────────────────────────

pub struct WorktreeRecord<'a> {
    pub agent_id: &'a str,
    pub worktree_path: &'a str,
    pub worktree_branch: &'a str,
    pub worktree_source_repo: &'a str,
    pub worktree_base_ref: &'a str,
}

/// Persist worktree metadata for an agent and rewrite its working
/// directory to point at the worktree. Called by `agent_spawn` once
/// the worktree manager has finished creating the worktree on disk.
pub async fn set_agent_worktree(
    pool: &SqlitePool,
    record: WorktreeRecord<'_>,
) -> Result<(), DbError> {
    sqlx::query(
        "UPDATE agents
         SET has_worktree = 1,
             working_dir = ?,
             worktree_path = ?,
             worktree_branch = ?,
             worktree_source_repo = ?,
             worktree_base_ref = ?,
             updated_at = ?
         WHERE id = ?",
    )
    .bind(record.worktree_path)
    .bind(record.worktree_path)
    .bind(record.worktree_branch)
    .bind(record.worktree_source_repo)
    .bind(record.worktree_base_ref)
    .bind(Utc::now())
    .bind(record.agent_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Clear worktree metadata. Used during a failed-spawn rollback or
/// before deletion.
pub async fn clear_agent_worktree(pool: &SqlitePool, agent_id: &str) -> Result<(), DbError> {
    sqlx::query(
        "UPDATE agents
         SET has_worktree = 0,
             worktree_path = NULL,
             worktree_branch = NULL,
             worktree_source_repo = NULL,
             worktree_base_ref = NULL,
             updated_at = ?
         WHERE id = ?",
    )
    .bind(Utc::now())
    .bind(agent_id)
    .execute(pool)
    .await?;
    Ok(())
}

// ─── Phase 5: teams + folder access ───────────────────────────────────────

pub struct NewTeam<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub color: &'a str,
}

pub async fn insert_team(pool: &SqlitePool, new: NewTeam<'_>) -> Result<Team, DbError> {
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO teams (id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(new.id)
    .bind(new.name)
    .bind(new.color)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;
    get_team(pool, new.id)
        .await?
        .ok_or_else(|| DbError::Sqlx(sqlx::Error::RowNotFound))
}

pub async fn get_team(pool: &SqlitePool, id: &str) -> Result<Option<Team>, DbError> {
    let row = sqlx::query_as::<_, Team>("SELECT * FROM teams WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row)
}

pub async fn list_teams(pool: &SqlitePool) -> Result<Vec<Team>, DbError> {
    let rows = sqlx::query_as::<_, Team>("SELECT * FROM teams ORDER BY created_at ASC")
        .fetch_all(pool)
        .await?;
    Ok(rows)
}

pub async fn update_team(
    pool: &SqlitePool,
    id: &str,
    name: Option<&str>,
    color: Option<&str>,
) -> Result<(), DbError> {
    let now = Utc::now();
    if let Some(n) = name {
        sqlx::query("UPDATE teams SET name = ?, updated_at = ? WHERE id = ?")
            .bind(n)
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(c) = color {
        sqlx::query("UPDATE teams SET color = ?, updated_at = ? WHERE id = ?")
            .bind(c)
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// Update the placeholder hint that gives empty teams a default
/// bounding box. Pass `None` to clear the hint and revert to "fit
/// to members".
pub async fn update_team_hint(
    pool: &SqlitePool,
    id: &str,
    hint: Option<(f64, f64, f64, f64)>,
) -> Result<(), DbError> {
    let now = Utc::now();
    let (x, y, w, h) = match hint {
        Some(h) => (Some(h.0), Some(h.1), Some(h.2), Some(h.3)),
        None => (None, None, None, None),
    };
    sqlx::query(
        "UPDATE teams
         SET hint_x = ?, hint_y = ?, hint_width = ?, hint_height = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(x)
    .bind(y)
    .bind(w)
    .bind(h)
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete a team. Members are not cascaded — `agents.team_id` is set
/// to NULL by the FK (none currently) so we update manually first.
pub async fn delete_team(pool: &SqlitePool, id: &str) -> Result<(), DbError> {
    sqlx::query("UPDATE agents SET team_id = NULL, updated_at = ? WHERE team_id = ?")
        .bind(Utc::now())
        .bind(id)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM teams WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Set the agent's team membership. `team_id = None` clears it.
pub async fn set_agent_team(
    pool: &SqlitePool,
    agent_id: &str,
    team_id: Option<&str>,
) -> Result<(), DbError> {
    sqlx::query("UPDATE agents SET team_id = ?, updated_at = ? WHERE id = ?")
        .bind(team_id)
        .bind(Utc::now())
        .bind(agent_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Phase 5: per-agent folder allowlist. Stored as a JSON array of
/// absolute paths in `agents.folder_access`. Working dir is
/// implicit and never appears in this list.
pub async fn update_agent_folder_access(
    pool: &SqlitePool,
    agent_id: &str,
    folders_json: &str,
) -> Result<(), DbError> {
    sqlx::query("UPDATE agents SET folder_access = ?, updated_at = ? WHERE id = ?")
        .bind(folders_json)
        .bind(Utc::now())
        .bind(agent_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_messages_for_agent(
    pool: &SqlitePool,
    agent_id: &str,
    limit: i64,
) -> Result<Vec<Message>, DbError> {
    let rows = sqlx::query_as::<_, Message>(
        "SELECT m.* FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.agent_id = ?
         ORDER BY m.created_at ASC
         LIMIT ?",
    )
    .bind(agent_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn memory_pool() -> sqlx::SqlitePool {
        let opts = sqlx::sqlite::SqliteConnectOptions::new()
            .in_memory(true)
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn insert_and_get_agent_roundtrip() {
        let pool = memory_pool().await;
        let agent = insert_agent(
            &pool,
            NewAgent {
                id: "agent-1",
                name: "Scout",
                emoji: "🛰️",
                color: "#5E6AD2",
                working_dir: "/tmp/scout",
                model_override: None,
                position_x: 0.0,
                position_y: 0.0,
            },
        )
        .await
        .unwrap();

        assert_eq!(agent.name, "Scout");
        assert_eq!(agent.status, "idle");
        assert!(agent.session_id.is_none());

        let fetched = get_agent(&pool, "agent-1").await.unwrap().unwrap();
        assert_eq!(fetched.id, agent.id);
        assert_eq!(fetched.created_at, agent.created_at);
    }

    #[tokio::test]
    async fn update_session_id_persists() {
        let pool = memory_pool().await;
        insert_agent(
            &pool,
            NewAgent {
                id: "a",
                name: "A",
                emoji: "🌟",
                color: "#5E6AD2",
                working_dir: "/tmp",
                model_override: None,
                position_x: 0.0,
                position_y: 0.0,
            },
        )
        .await
        .unwrap();

        update_agent_session_id(&pool, "a", "sess-123")
            .await
            .unwrap();
        let got = get_agent(&pool, "a").await.unwrap().unwrap();
        assert_eq!(got.session_id.as_deref(), Some("sess-123"));
    }

    #[tokio::test]
    async fn get_or_create_conversation_is_stable() {
        let pool = memory_pool().await;
        insert_agent(
            &pool,
            NewAgent {
                id: "a",
                name: "A",
                emoji: "🌟",
                color: "#5E6AD2",
                working_dir: "/tmp",
                model_override: None,
                position_x: 0.0,
                position_y: 0.0,
            },
        )
        .await
        .unwrap();

        let conv1 = get_or_create_conversation_for_agent(&pool, "a")
            .await
            .unwrap();
        let conv2 = get_or_create_conversation_for_agent(&pool, "a")
            .await
            .unwrap();
        assert_eq!(conv1.id, conv2.id);
    }

    #[tokio::test]
    async fn messages_list_in_order_for_agent() {
        let pool = memory_pool().await;
        insert_agent(
            &pool,
            NewAgent {
                id: "a",
                name: "A",
                emoji: "🌟",
                color: "#5E6AD2",
                working_dir: "/tmp",
                model_override: None,
                position_x: 0.0,
                position_y: 0.0,
            },
        )
        .await
        .unwrap();
        let conv = get_or_create_conversation_for_agent(&pool, "a")
            .await
            .unwrap();

        let t0 = Utc::now();
        for i in 0..3 {
            insert_message(
                &pool,
                NewMessage {
                    id: &format!("m-{i}"),
                    conversation_id: &conv.id,
                    role: MessageRole::User,
                    content: &format!("{{\"text\":\"hello {i}\"}}"),
                    created_at: t0 + chrono::Duration::milliseconds(i),
                },
            )
            .await
            .unwrap();
        }

        let msgs = list_messages_for_agent(&pool, "a", 200).await.unwrap();
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[0].id, "m-0");
        assert_eq!(msgs[2].id, "m-2");
    }

    async fn insert_test_agent(pool: &SqlitePool, id: &str) {
        insert_agent(
            pool,
            NewAgent {
                id,
                name: "A",
                emoji: "🌟",
                color: "#5E6AD2",
                working_dir: "/tmp",
                model_override: None,
                position_x: 0.0,
                position_y: 0.0,
            },
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn update_identity_marks_dirty() {
        let pool = memory_pool().await;
        insert_test_agent(&pool, "a").await;

        update_agent_identity(&pool, "a", Some("calm engineer"), None)
            .await
            .unwrap();

        let got = get_agent(&pool, "a").await.unwrap().unwrap();
        assert_eq!(got.soul.as_deref(), Some("calm engineer"));
        assert!(got.purpose.is_none());
        assert_eq!(got.identity_dirty, 1);

        set_identity_dirty(&pool, "a", false).await.unwrap();
        let cleared = get_agent(&pool, "a").await.unwrap().unwrap();
        assert_eq!(cleared.identity_dirty, 0);
    }

    #[tokio::test]
    async fn memory_insert_list_search_update_delete() {
        let pool = memory_pool().await;
        insert_test_agent(&pool, "a").await;

        for (i, content) in [
            "use Tailwind v3",
            "table is named usres not users",
            "uuid v4",
        ]
        .iter()
        .enumerate()
        {
            insert_memory_entry(
                &pool,
                NewMemoryEntry {
                    id: &format!("m-{i}"),
                    agent_id: "a",
                    content,
                    category: None,
                    source: MemorySource::User,
                },
            )
            .await
            .unwrap();
            // Force ordering: DateTime<Utc>::now() at sub-ms can collide on
            // some platforms; nudge by one ms.
            tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        }

        let all = list_memory_entries(&pool, "a", None).await.unwrap();
        assert_eq!(all.len(), 3);
        // Newest first.
        assert_eq!(all[0].content, "uuid v4");

        let usres = list_memory_entries(&pool, "a", Some("USRES"))
            .await
            .unwrap();
        assert_eq!(usres.len(), 1);
        assert_eq!(usres[0].content, "table is named usres not users");

        let updated = update_memory_entry(&pool, "m-0", "use Tailwind v3 only")
            .await
            .unwrap();
        assert_eq!(updated.content, "use Tailwind v3 only");

        delete_memory_entry(&pool, "m-1").await.unwrap();
        let remaining = list_memory_entries(&pool, "a", None).await.unwrap();
        assert_eq!(remaining.len(), 2);
    }

    #[tokio::test]
    async fn recent_memory_caps_to_limit() {
        let pool = memory_pool().await;
        insert_test_agent(&pool, "a").await;

        for i in 0..5 {
            insert_memory_entry(
                &pool,
                NewMemoryEntry {
                    id: &format!("m-{i}"),
                    agent_id: "a",
                    content: &format!("entry {i}"),
                    category: None,
                    source: MemorySource::Agent,
                },
            )
            .await
            .unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        }

        let recent = recent_memory_entries(&pool, "a", 3).await.unwrap();
        assert_eq!(recent.len(), 3);
        assert_eq!(recent[0].content, "entry 4");
        assert_eq!(recent[2].content, "entry 2");
    }

    #[tokio::test]
    async fn deleting_agent_cascades_memory() {
        let pool = memory_pool().await;
        insert_test_agent(&pool, "a").await;
        insert_memory_entry(
            &pool,
            NewMemoryEntry {
                id: "m-1",
                agent_id: "a",
                content: "x",
                category: None,
                source: MemorySource::User,
            },
        )
        .await
        .unwrap();

        delete_agent(&pool, "a").await.unwrap();
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM memory_entries")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 0);
    }

    #[tokio::test]
    async fn inter_agent_message_lifecycle_and_audit_log() {
        let pool = memory_pool().await;
        insert_test_agent(&pool, "a").await;
        insert_test_agent(&pool, "b").await;

        let m = insert_inter_agent_message(
            &pool,
            NewInterAgentMessage {
                id: "iam-1",
                from_agent_id: "a",
                to_agent_id: "b",
                content: "hi from A",
                origin_human_message_id: None,
                depth: 1,
            },
        )
        .await
        .unwrap();
        assert_eq!(m.status, "pending");
        assert!(m.delivered_at.is_none());

        update_inter_agent_message_status(&pool, "iam-1", InterAgentMessageStatus::Delivered)
            .await
            .unwrap();
        let after = &list_inter_agent_messages_for_agent(&pool, "b", 10)
            .await
            .unwrap()[0];
        assert_eq!(after.status, "delivered");
        assert!(after.delivered_at.is_some());

        // Both endpoints see the row.
        assert_eq!(
            list_inter_agent_messages_for_agent(&pool, "a", 10)
                .await
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            list_inter_agent_audit_log(&pool, 10).await.unwrap().len(),
            1
        );
    }

    #[tokio::test]
    async fn deleting_agent_cascades_inter_agent_messages() {
        let pool = memory_pool().await;
        insert_test_agent(&pool, "a").await;
        insert_test_agent(&pool, "b").await;
        insert_inter_agent_message(
            &pool,
            NewInterAgentMessage {
                id: "iam-1",
                from_agent_id: "a",
                to_agent_id: "b",
                content: "hi",
                origin_human_message_id: None,
                depth: 1,
            },
        )
        .await
        .unwrap();
        delete_agent(&pool, "a").await.unwrap();
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM inter_agent_messages")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 0);
    }

    #[tokio::test]
    async fn team_create_assign_member_and_delete_clears_membership() {
        let pool = memory_pool().await;
        insert_test_agent(&pool, "a").await;
        insert_test_agent(&pool, "b").await;

        let team = insert_team(
            &pool,
            NewTeam {
                id: "t-1",
                name: "Payments",
                color: "#7ec891",
            },
        )
        .await
        .unwrap();
        assert_eq!(team.name, "Payments");

        set_agent_team(&pool, "a", Some("t-1")).await.unwrap();
        set_agent_team(&pool, "b", Some("t-1")).await.unwrap();

        let teams = list_teams(&pool).await.unwrap();
        assert_eq!(teams.len(), 1);

        delete_team(&pool, "t-1").await.unwrap();
        let after_a = get_agent(&pool, "a").await.unwrap().unwrap();
        let after_b = get_agent(&pool, "b").await.unwrap().unwrap();
        assert!(after_a.team_id.is_none());
        assert!(after_b.team_id.is_none());
        assert_eq!(list_teams(&pool).await.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn update_team_hint_round_trips() {
        let pool = memory_pool().await;
        insert_team(
            &pool,
            NewTeam {
                id: "t-1",
                name: "X",
                color: "#000",
            },
        )
        .await
        .unwrap();

        update_team_hint(&pool, "t-1", Some((10.0, 20.0, 240.0, 120.0)))
            .await
            .unwrap();
        let got = get_team(&pool, "t-1").await.unwrap().unwrap();
        assert_eq!(got.hint_x, Some(10.0));
        assert_eq!(got.hint_width, Some(240.0));

        update_team_hint(&pool, "t-1", None).await.unwrap();
        let cleared = get_team(&pool, "t-1").await.unwrap().unwrap();
        assert!(cleared.hint_x.is_none());
        assert!(cleared.hint_width.is_none());
    }

    #[tokio::test]
    async fn folder_access_round_trips() {
        let pool = memory_pool().await;
        insert_test_agent(&pool, "a").await;
        update_agent_folder_access(&pool, "a", "[\"/home/me/api\",\"/home/me/lib\"]")
            .await
            .unwrap();
        let got = get_agent(&pool, "a").await.unwrap().unwrap();
        assert_eq!(got.folder_access, "[\"/home/me/api\",\"/home/me/lib\"]");
    }

    #[tokio::test]
    async fn worktree_metadata_round_trips_and_clears() {
        let pool = memory_pool().await;
        insert_test_agent(&pool, "a").await;

        set_agent_worktree(
            &pool,
            WorktreeRecord {
                agent_id: "a",
                worktree_path: "/data/worktrees/a",
                worktree_branch: "orbit/scout-abc123",
                worktree_source_repo: "/home/me/proj",
                worktree_base_ref: "deadbeef",
            },
        )
        .await
        .unwrap();

        let got = get_agent(&pool, "a").await.unwrap().unwrap();
        assert_eq!(got.has_worktree, 1);
        assert_eq!(got.working_dir, "/data/worktrees/a");
        assert_eq!(got.worktree_branch.as_deref(), Some("orbit/scout-abc123"));
        assert_eq!(got.worktree_base_ref.as_deref(), Some("deadbeef"));

        clear_agent_worktree(&pool, "a").await.unwrap();
        let cleared = get_agent(&pool, "a").await.unwrap().unwrap();
        assert_eq!(cleared.has_worktree, 0);
        assert!(cleared.worktree_branch.is_none());
        // working_dir is preserved — manager.remove() handles the
        // filesystem cleanup; the column doesn't revert on its own.
    }

    #[tokio::test]
    async fn task_lifecycle_create_update_status_complete_delete() {
        let pool = memory_pool().await;
        insert_test_agent(&pool, "a").await;

        let task = insert_task(
            &pool,
            NewTask {
                id: "t1",
                agent_id: "a",
                title: "Audit ratelimiter",
                description: Some("Find missing burst guard"),
                status: TaskStatus::Queued,
                priority: TaskPriority::Normal,
            },
        )
        .await
        .unwrap();
        assert_eq!(task.title, "Audit ratelimiter");
        assert_eq!(task.status, "queued");
        assert!(task.completed_at.is_none());

        // Status transitions stamp completed_at on Done.
        let running = update_task(&pool, "t1", None, None, Some(TaskStatus::Running), None)
            .await
            .unwrap();
        assert_eq!(running.status, "running");
        assert!(running.completed_at.is_none());

        let done = update_task(&pool, "t1", None, None, Some(TaskStatus::Done), None)
            .await
            .unwrap();
        assert_eq!(done.status, "done");
        assert!(done.completed_at.is_some());

        // Going back to queued clears completed_at.
        let requeued = update_task(&pool, "t1", None, None, Some(TaskStatus::Queued), None)
            .await
            .unwrap();
        assert!(requeued.completed_at.is_none());

        // Title-only update preserves status.
        let renamed = update_task(&pool, "t1", Some("Audit RL"), None, None, None)
            .await
            .unwrap();
        assert_eq!(renamed.title, "Audit RL");
        assert_eq!(renamed.status, "queued");

        delete_task(&pool, "t1").await.unwrap();
        assert!(get_task(&pool, "t1").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn deleting_agent_cascades_tasks() {
        let pool = memory_pool().await;
        insert_test_agent(&pool, "a").await;
        insert_task(
            &pool,
            NewTask {
                id: "t1",
                agent_id: "a",
                title: "x",
                description: None,
                status: TaskStatus::Queued,
                priority: TaskPriority::Normal,
            },
        )
        .await
        .unwrap();
        delete_agent(&pool, "a").await.unwrap();
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tasks")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 0);
    }

    #[tokio::test]
    async fn sticky_note_round_trip() {
        let pool = memory_pool().await;
        let note = insert_sticky_note(
            &pool,
            NewStickyNote {
                id: "s1",
                content: "review the diff",
                position_x: 100.0,
                position_y: 200.0,
                color: "#3a4a3e",
            },
        )
        .await
        .unwrap();
        assert_eq!(note.content, "review the diff");

        let moved = update_sticky_note(&pool, "s1", None, Some((300.0, 400.0)), None)
            .await
            .unwrap();
        assert_eq!(moved.position_x, 300.0);
        assert_eq!(moved.position_y, 400.0);

        let recolored = update_sticky_note(&pool, "s1", None, None, Some("#48383f"))
            .await
            .unwrap();
        assert_eq!(recolored.color, "#48383f");

        let edited = update_sticky_note(&pool, "s1", Some("ship it"), None, None)
            .await
            .unwrap();
        assert_eq!(edited.content, "ship it");

        delete_sticky_note(&pool, "s1").await.unwrap();
        assert!(get_sticky_note(&pool, "s1").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn group_thread_lifecycle_create_add_member_post_list_delete() {
        let pool = memory_pool().await;
        insert_test_agent(&pool, "a").await;
        insert_test_agent(&pool, "b").await;

        let thread = insert_group_thread(
            &pool,
            NewGroupThread {
                id: "g1",
                name: "deploy-pipeline",
                color: "#3a4a3e",
            },
        )
        .await
        .unwrap();
        assert_eq!(thread.name, "deploy-pipeline");

        add_group_member(&pool, "g1", "a").await.unwrap();
        add_group_member(&pool, "g1", "b").await.unwrap();
        // Idempotent on duplicate.
        add_group_member(&pool, "g1", "a").await.unwrap();

        let members = list_group_members(&pool, "g1").await.unwrap();
        assert_eq!(members.len(), 2);

        insert_group_message(
            &pool,
            NewGroupMessage {
                id: "m1",
                thread_id: "g1",
                sender_kind: "human",
                sender_agent_id: None,
                content: "kick off the migration",
            },
        )
        .await
        .unwrap();
        insert_group_message(
            &pool,
            NewGroupMessage {
                id: "m2",
                thread_id: "g1",
                sender_kind: "agent",
                sender_agent_id: Some("a"),
                content: "on it",
            },
        )
        .await
        .unwrap();

        let msgs = list_group_messages(&pool, "g1", 100).await.unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].id, "m1");
        assert_eq!(msgs[1].sender_kind, "agent");

        // Removing a member doesn't delete past messages.
        remove_group_member(&pool, "g1", "a").await.unwrap();
        assert_eq!(list_group_members(&pool, "g1").await.unwrap().len(), 1);
        assert_eq!(
            list_group_messages(&pool, "g1", 100).await.unwrap().len(),
            2
        );

        delete_group_thread(&pool, "g1").await.unwrap();
        assert!(get_group_thread(&pool, "g1").await.unwrap().is_none());
        // Cascade: members + messages gone.
        assert!(list_group_members(&pool, "g1").await.unwrap().is_empty());
        assert!(list_group_messages(&pool, "g1", 100)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn deleting_agent_cascades_group_membership_but_not_message_history() {
        let pool = memory_pool().await;
        insert_test_agent(&pool, "a").await;
        insert_group_thread(
            &pool,
            NewGroupThread {
                id: "g1",
                name: "g",
                color: "#000",
            },
        )
        .await
        .unwrap();
        add_group_member(&pool, "g1", "a").await.unwrap();
        insert_group_message(
            &pool,
            NewGroupMessage {
                id: "m1",
                thread_id: "g1",
                sender_kind: "agent",
                sender_agent_id: Some("a"),
                content: "hi",
            },
        )
        .await
        .unwrap();

        delete_agent(&pool, "a").await.unwrap();
        // Membership row gone (cascade).
        assert!(list_group_members(&pool, "g1").await.unwrap().is_empty());
        // But the message stays for replay; sender_agent_id null'd by FK.
        let msgs = list_group_messages(&pool, "g1", 100).await.unwrap();
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].sender_agent_id.is_none());
    }

    #[tokio::test]
    async fn mcp_server_lifecycle_with_defaults() {
        let pool = memory_pool().await;
        let stdio = insert_mcp_server(
            &pool,
            NewMcpServer {
                id: "s1",
                name: "filesystem",
                transport: "stdio",
                command: Some("npx"),
                args_json: "[\"-y\",\"@modelcontextprotocol/server-filesystem\",\"/home/me\"]",
                env_json: "{}",
                url: None,
                is_default: true,
            },
        )
        .await
        .unwrap();
        assert_eq!(stdio.transport, "stdio");
        assert_eq!(stdio.is_default, 1);

        insert_mcp_server(
            &pool,
            NewMcpServer {
                id: "s2",
                name: "github",
                transport: "http",
                command: None,
                args_json: "[]",
                env_json: "{}",
                url: Some("http://localhost:9090/mcp"),
                is_default: false,
            },
        )
        .await
        .unwrap();

        assert_eq!(list_mcp_servers(&pool).await.unwrap().len(), 2);
        let defaults = list_default_mcp_servers(&pool).await.unwrap();
        assert_eq!(defaults.len(), 1);
        assert_eq!(defaults[0].name, "filesystem");

        update_mcp_server(
            &pool,
            "s2",
            McpServerUpdate {
                is_default: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(list_default_mcp_servers(&pool).await.unwrap().len(), 2);

        delete_mcp_server(&pool, "s1").await.unwrap();
        assert_eq!(list_mcp_servers(&pool).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn delete_agent_cascades_to_conversations_and_messages() {
        let pool = memory_pool().await;
        insert_agent(
            &pool,
            NewAgent {
                id: "a",
                name: "A",
                emoji: "🌟",
                color: "#5E6AD2",
                working_dir: "/tmp",
                model_override: None,
                position_x: 0.0,
                position_y: 0.0,
            },
        )
        .await
        .unwrap();
        let conv = get_or_create_conversation_for_agent(&pool, "a")
            .await
            .unwrap();
        insert_message(
            &pool,
            NewMessage {
                id: "m-1",
                conversation_id: &conv.id,
                role: MessageRole::User,
                content: "{}",
                created_at: Utc::now(),
            },
        )
        .await
        .unwrap();

        delete_agent(&pool, "a").await.unwrap();

        let remaining: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM messages")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(remaining.0, 0);
    }
}
