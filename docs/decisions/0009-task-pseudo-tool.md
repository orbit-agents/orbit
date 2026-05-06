# ADR 0009 — `<task>` pseudo-tool, activity feed (not reports)

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

Phase 7 introduces:

1. **Per-agent task lists** the human can see and edit, and the agent
   can manage on its own.
2. **Periodic status reports** posted to a "shared channel."
3. **Sticky notes** for human canvas annotation.

Two design questions ride above the obvious schema work:

- How does the agent express tasks? A new MCP tool? An extension of
  the existing pseudo-tool family (`<remember>`, `<send_to>`)?
- How do "status reports" work? A separate `reports` entity with its
  own schema and lifecycle, or a derived activity feed?

## Decision

1. **Tasks: ship `<task>` as a third pseudo-tool**, parsed by
   `agents::extract` alongside `<remember>` (ADR 0005) and
   `<send_to>` (ADR 0006). Two operations: `action="create"` and
   `action="update"`. Migrates to MCP in Phase 8 along with the other
   two markers.
2. **Status reports: derived activity feed.** No new entity. The feed
   is the union of `tasks.updated_at` (status transitions are events)
   and `memory_entries.created_at WHERE source = 'agent'`, sorted
   chronologically. Single IPC: `agent_get_activity_feed(limit)`.

## Marker syntax

Same on-its-own-line rule as the other pseudo-tools. Two forms:

```
<task action="create" status="queued" priority="normal">title — description</task>
<task action="update" id="<uuid>" status="done">optional new title — optional new description</task>
```

Attribute rules:

- `action`: required, `"create"` or `"update"`. Anything else: drop.
- `status`: required on `create`, optional on `update`. Must be one of
  `queued | running | awaiting_human | blocked | done | failed`.
- `priority`: optional, defaults to `normal`. `low | normal | high`.
- `id`: required on `update`, ignored on `create` (we generate one).
- Body text: `title` and optional `description` separated by `—`
  (em dash with surrounding spaces). On `update`, body is optional —
  if the agent is just flipping status, it can leave the body empty.

Examples:

```
<task action="create" status="queued" priority="high">Audit the rate limiter — Find missing burst guard in src/middleware</task>
<task action="update" id="3f9e..." status="running"></task>
<task action="update" id="3f9e..." status="done">Audit rate limiter — Filed PR #2851</task>
```

## Why pseudo-tool, not MCP

Same reasoning as ADR 0005 / ADR 0006: shipping a real MCP server is
Phase 8 work. Phase 7 is already three subsystems (tasks, feed,
sticky notes). The pseudo-tool path lets us reuse the
`agents::extract` pipeline (single per-turn pass), the line-anchored
mid-prose-safe rule, and the truncation cap. Phase 8 migrates all
three markers to MCP in one swap.

## Why activity feed, not reports

A separate `reports` table would mean:

- A second source of "what is the agent doing" alongside tasks.
- A scheduling story (when does a report get written?).
- A deduplication story (status went queued → running → done; did
  that produce one report or three?).
- A new UI surface to render a different kind of object.

None of those add user value over "show me what changed recently."
The feed is the truth: every task transition is already a row update
with a known `updated_at`; every agent-saved memory is already a row
with `source = 'agent'`. Joining and sorting them gives a faithful
chronological log without inventing a new entity.

If Phase 7+ needs richer reports (e.g. "weekly digest"), they can be
saved-views over the same activity feed.

## Edge cases

- **Marker discussed mid-prose.** Per the on-its-own-line rule
  (inherited from ADR 0005), an agent answering a question about
  task syntax does not invoke the tool.
- **Unknown task id on update.** Soft-fail: log a warning, skip the
  update, do not crash the turn. The agent's next turn re-renders
  the task list anyway.
- **Body length cap.** Same 8 KB cap as `<remember>`/`<send_to>`.
- **Status not in the allowed set.** Drop the marker silently.
- **Missing `id` on update.** Drop the marker. Per the spec answer
  ("agent must specify task id explicitly"), there is no implicit
  "current task" pointer — a footgun avoided.

## Tradeoffs

- **Determinism is weaker than MCP.** Same as the other markers; the
  system prompt is explicit. Phase 8 migrates.
- **Body parsing uses `—` as a separator.** Cute but fragile if the
  agent uses an em dash inside the title. Mitigation: only the first
  `—` splits; subsequent ones stay in the description.
- **Activity feed is computed on every read.** Cheap at Phase 7
  scale (tens of tasks per agent). Phase 7+ optimization: cache or
  materialize if it ever shows up in profiling.

## Sticky notes

Sticky notes are NOT part of the agent surface. Agents can't read or
write them. They live in their own table, are created/edited by the
human only, and don't go through the broker. Phase 7 ships them as a
canvas-only feature.

## Consequences

- A new module `agents::tasks` (parallel to `agents::remember`)
  hosts task-marker handling. Or — to avoid a one-function module —
  the dispatch happens directly in `agents::turn` after extraction.
- `agents::extract::ExtractionResult` grows a `tasks: Vec<ExtractedTask>`
  field. The extractor handles the parsing; `turn` does the side
  effects (DB writes, event emission).
- A new Tauri command `agent_get_activity_feed(limit)` joins the
  `tasks` and `memory_entries` tables and emits a unified event
  stream.
- The `agent:task_created` and `agent:task_updated` events fire
  whenever the agent or a human mutates a task; the frontend in
  `use-agent-events` updates the store optimistically.

## Expiration

Same as ADR 0005 / 0006: revisit when Phase 8's MCP infrastructure
lands. Migration mirrors the other two markers — drop the
`### Using the task tool` subsection from the system prompt, replace
the per-turn line extractor with an MCP `tool_use` handler. Schema
and frontend behavior do not change.
