-- Phase 7: per-agent tasks + canvas sticky notes.
--
-- Tasks: agents create/update via the `<task>` pseudo-tool (ADR 0009);
-- humans create/edit/delete via the right-panel Tasks section + the
-- Task Inbox view. The same `tasks` table is the source of truth for
-- both surfaces.
--
-- Sticky notes: human-only canvas annotations. Agents don't see them
-- and can't write them. Lives in its own table independent of agents.
--
-- Idempotent (CREATE TABLE / CREATE INDEX IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS tasks (
    id           TEXT PRIMARY KEY NOT NULL,
    agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT,
    status       TEXT NOT NULL
        CHECK (status IN ('queued', 'running', 'awaiting_human', 'blocked', 'done', 'failed')),
    priority     TEXT NOT NULL
        CHECK (priority IN ('low', 'normal', 'high'))
        DEFAULT 'normal',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_agent
    ON tasks (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_status
    ON tasks (status, created_at DESC);

CREATE TABLE IF NOT EXISTS sticky_notes (
    id          TEXT PRIMARY KEY NOT NULL,
    content     TEXT NOT NULL,
    position_x  REAL NOT NULL,
    position_y  REAL NOT NULL,
    color       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
