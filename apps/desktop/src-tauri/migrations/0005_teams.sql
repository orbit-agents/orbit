-- Phase 5: teams (visual groupings with bounds).
--
-- Teams are derived-not-authored — region bounds on the canvas are
-- computed at render time from member positions plus 16px padding.
-- The optional hint_* columns let an empty team (no members yet)
-- carry a placeholder bounding box so it stays visible. Members
-- carry `team_id` directly on `agents` (column reserved by 0001).
--
-- Idempotent (CREATE TABLE / CREATE INDEX IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS teams (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL,
    -- Optional minimum-bounds hint for empty teams. NULL means
    -- "compute from members alone, fall back to a default
    -- placeholder when empty".
    hint_x      REAL,
    hint_y      REAL,
    hint_width  REAL,
    hint_height REAL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agents_team
    ON agents (team_id);
