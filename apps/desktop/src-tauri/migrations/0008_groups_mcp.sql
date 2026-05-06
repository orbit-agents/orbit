-- Phase 8: group threads + MCP server registry.
--
-- Group threads piggy-back on the Phase 4 broker for delivery — the
-- human posts a message, we synthesize one inter-agent-style turn per
-- member with `group_id` carried in the inbound annotation, and the
-- recipient's reply gets posted back to the thread automatically.
--
-- Group messages live in their own table so the per-conversation
-- `messages` table for direct-chat history stays clean.
--
-- MCP servers are user-configured external tool servers passed to
-- Claude Code via `--mcp-config` at spawn. Per-agent config files
-- get materialized at `<data-dir>/mcp/<agent-id>.json` so different
-- agents can have different toolsets.
--
-- Idempotent (CREATE TABLE / CREATE INDEX IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS group_threads (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_thread_members (
    thread_id  TEXT NOT NULL REFERENCES group_threads(id) ON DELETE CASCADE,
    agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    added_at   TEXT NOT NULL,
    PRIMARY KEY (thread_id, agent_id)
);

CREATE TABLE IF NOT EXISTS group_messages (
    id              TEXT PRIMARY KEY NOT NULL,
    thread_id       TEXT NOT NULL REFERENCES group_threads(id) ON DELETE CASCADE,
    sender_kind     TEXT NOT NULL CHECK (sender_kind IN ('human', 'agent')),
    sender_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    content         TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_group_messages_thread
    ON group_messages (thread_id, created_at ASC);

CREATE TABLE IF NOT EXISTS mcp_servers (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    -- 'stdio' for local subprocess MCP servers; 'http' for remote.
    transport   TEXT NOT NULL CHECK (transport IN ('stdio', 'http')),
    -- stdio transport: command + args + env. JSON-encoded arrays so
    -- the schema doesn't need to chase whatever quoting behavior the
    -- platform ships.
    command     TEXT,
    args_json   TEXT NOT NULL DEFAULT '[]',
    env_json    TEXT NOT NULL DEFAULT '{}',
    -- http transport: server URL.
    url         TEXT,
    -- Default servers get included in every newly-spawned agent's
    -- mcp config. Toggle from the UI per server.
    is_default  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
