-- Phase 3: agent identity + memory.
--
-- The 0001 migration already reserved `soul`, `purpose`, and `memory` columns
-- on `agents`. We keep `soul` and `purpose` (still TEXT, nullable) and now
-- treat the legacy `memory` column as deprecated — Phase 3 stores memory as
-- per-row entries in a dedicated table so the UI can search, edit, and
-- delete them individually.
--
-- New columns / tables are idempotent (IF NOT EXISTS) so re-running the
-- migration against an already-migrated database is safe.

-- Tracks whether the agent's running session has been told about the
-- latest soul/purpose/memory. The supervisor reads this on every send;
-- when 1, it prepends a <system_update> block to the next user message
-- and clears the flag.
ALTER TABLE agents ADD COLUMN identity_dirty INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS memory_entries (
    id          TEXT PRIMARY KEY NOT NULL,
    agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    category    TEXT,
    -- 'user'     — written by the human via the Memory editor
    -- 'agent'    — saved by the agent via the `remember` pseudo-tool
    -- 'imported' — pulled in from a CLAUDE.md file at spawn time
    source      TEXT NOT NULL CHECK (source IN ('user', 'agent', 'imported')),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_agent
    ON memory_entries (agent_id, created_at DESC);
