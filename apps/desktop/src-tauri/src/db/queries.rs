//! CRUD helpers for Phase 1. Query strings are kept short and typed at the
//! call site with `query_as`. Compile-time checked queries (`query!`) are a
//! future change once the schema stabilizes.

use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use super::models::{Agent, Conversation, MemoryEntry, MemorySource, Message, MessageRole};
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
    use super::super::*;
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
