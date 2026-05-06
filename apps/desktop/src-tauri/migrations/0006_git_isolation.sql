-- Phase 6: per-agent git worktrees and branches.
--
-- An agent spawned inside a Git repository gets its own worktree at
-- <data-dir>/worktrees/<agent-id> on a dedicated branch named
-- `orbit/<slug>-<short-id>`. The agent's working_dir is rewritten
-- to the worktree path. Spawning in a non-Git directory leaves
-- has_worktree = 0 and behaves like Phase 1.
--
-- worktree_base_ref captures the source repo's HEAD commit at create
-- time so diffs always render against a stable point — even if the
-- user rebases the source repo afterwards.
--
-- Idempotent (no IF NOT EXISTS guards on ALTER COLUMN; sqlx tracks
-- which migrations have run, so this file only executes once).

ALTER TABLE agents ADD COLUMN has_worktree         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN worktree_path        TEXT;
ALTER TABLE agents ADD COLUMN worktree_branch      TEXT;
ALTER TABLE agents ADD COLUMN worktree_source_repo TEXT;
ALTER TABLE agents ADD COLUMN worktree_base_ref    TEXT;
