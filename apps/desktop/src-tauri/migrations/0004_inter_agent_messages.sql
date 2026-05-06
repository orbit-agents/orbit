-- Phase 4: agent-to-agent messaging audit table.
--
-- Every message routed through the broker writes a row here BEFORE
-- dispatch (write-then-emit, same pattern as Phase 1 user messages).
-- The DB is the audit log; the live transport is an in-process Tokio
-- channel (see broker::Broker). Status moves pending → delivered →
-- (acknowledged | failed).
--
-- The `origin_human_message_id` plus `depth` columns implement the loop
-- guard from the Phase 4 spec: a chain of synthetic user turns deeper
-- than 8 since the last human message is rejected.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS) so re-running the migration
-- against an already-migrated database is safe.

CREATE TABLE IF NOT EXISTS inter_agent_messages (
    id                       TEXT PRIMARY KEY NOT NULL,
    from_agent_id            TEXT NOT NULL REFERENCES agents(id)   ON DELETE CASCADE,
    to_agent_id              TEXT NOT NULL REFERENCES agents(id)   ON DELETE CASCADE,
    content                  TEXT NOT NULL,
    -- The human-sent message that ultimately triggered this chain.
    -- NULL is allowed for messages emitted outside any human turn
    -- (Phase 7 scheduled tasks; rare).
    origin_human_message_id  TEXT          REFERENCES messages(id) ON DELETE SET NULL,
    depth                    INTEGER NOT NULL DEFAULT 1,
    status                   TEXT NOT NULL
        CHECK (status IN ('pending', 'delivered', 'acknowledged', 'failed')),
    created_at               TEXT NOT NULL,
    delivered_at             TEXT
);

CREATE INDEX IF NOT EXISTS idx_iam_from
    ON inter_agent_messages (from_agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_iam_to
    ON inter_agent_messages (to_agent_id, created_at DESC);
