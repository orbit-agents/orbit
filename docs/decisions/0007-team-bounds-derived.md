# ADR 0007 — Team region bounds are derived, not authored

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

Phase 5 introduces visual team groupings on the canvas. A team is a
named, colored region drawn behind the agent nodes that belong to it.
Two ways to model the region's bounding box on the canvas:

1. **Authored.** The user resizes the team rectangle directly. Bounds
   are persisted (`teams.x/y/width/height`) and members happen to sit
   inside whichever team region they fall into. Membership = "agent
   is geometrically inside this rectangle."
2. **Derived.** Members carry `team_id` directly on `agents`. The
   region's bounds are computed at render time from member positions
   plus padding. Members can be anywhere; the region follows them.

## Decision

**Derived. Members carry `team_id`; render computes bounds from member
positions + 16px padding + 8px label headroom. Empty teams fall back
to an optional `hint*` rectangle (default 240×120 near the origin).**

Implementation lives in
[`apps/desktop/src/features/canvas/team-bounds.ts`](../../apps/desktop/src/features/canvas/team-bounds.ts);
the canvas's `<TeamRegionLayer />` and `onNodeDragStop` hit-test both
read from the same util.

## Rationale

- **No drift.** With authored bounds, members move and the rectangle
  doesn't follow — or it does but you write to SQLite on every drag,
  which we already established (ADR 0004) is the wrong mental model.
  Derived bounds always show the truth.
- **Drag-into-team is a clean primitive.** On `onNodeDragStop` we
  rebuild regions and ask "which region's rectangle contains this
  agent's center?" — one function call. With authored bounds the
  hit-test is the same shape but you also need a separate "drag the
  region itself" interaction.
- **Schema stays small.** No `(x, y, w, h)` per row that has to track
  the most-recent member arrangement. The optional `hint*` columns
  are a single optimization for the empty-team case and don't carry
  load when teams have members.
- **Empty teams still have presence.** The `hint*` fallback gives
  every newly-created team a visible 240×120 placeholder near the
  origin (or wherever the user requests). Drag an agent into that
  placeholder and the region snaps to the new derived bounds.

## Tradeoffs

- **The user can't draw a region first and then assign agents to it.**
  The flow is always agent-first. If we ever need "carve out a
  rectangle and assign by selection," that's a new gesture, not a
  schema change.
- **Members at extreme positions blow up the region.** If one agent
  is at (0, 0) and another at (5000, 5000), the team region is huge.
  Acceptable — that's exactly the layout the user chose.
- **Two members on top of each other look like a single-agent team.**
  Fine — it's still a derived rectangle.

## Smallest-enclosing tie-breaker

When regions overlap (rare; usually only when teams visibly nest
because someone grouped a team's members tightly inside another's
bounds), `findTeamAtPoint` picks the **smallest** containing region.
This makes a nested sub-team's drop zone reliably win over its
parent's, which matches the user's likely intent.

## Alternatives considered

- **Hybrid (authored hints, derived if-empty).** Considered keeping
  user-resizable bounds as the source of truth and making "fit to
  members" an opt-in toggle. Rejected — the dual model meant two
  hit-test paths and twice the bug surface.
- **Convex hull rather than axis-aligned bounding box.** Visually
  nicer for irregular member layouts; rejected on cost. Phase 5
  doesn't need it; Phase 7 might revisit.
- **Per-team `bounds_locked` flag** that switches a team between
  authored and derived. Same complexity argument as hybrid; deferred.

## Consequences

- All canvas-coordinate region math lives in one util
  (`team-bounds.ts`); both the renderer and the drag handler share it.
- Phase 5 schema needs only the `teams` row + `agents.team_id`. No
  per-team bounds columns.
- The `hint*` columns are write-rarely: they exist for empty-team
  placeholders and a future "place an empty team here" gesture.
- Future phases that want to draw lines between teams (e.g. Phase 4
  message arcs that route between team centroids) get a stable input
  from the same util.

## Expiration

Revisit only if a real product requirement appears that derived
bounds can't satisfy — for example, "lock this team's region
position so dragging members doesn't move it." Until then this is
the model.
