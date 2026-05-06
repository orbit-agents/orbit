# ADR 0006 — `send_message_to_agent` ships as a `<send_to>` pseudo-tool

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

Phase 4 makes agent-to-agent messaging a first-class feature. CLAUDE.md
rule #2 mandates that all such messaging route through the core broker
— never directly between agents — so the user gets transparency,
auditability, rate-limiting, and replay.

The agent-facing surface is a tool: `send_message_to_agent(to: agent_name,
content: string)`. The transport question matches the one ADR 0005
solved for `<remember>`:

1. Build an in-process MCP server now and expose the tool via
   `--mcp-config`.
2. Document the tool as a prompt-based pseudo-tool — a marker the
   model emits that the supervisor parses out of the assistant text
   stream.

## Decision

**Phase 4 ships `send_message_to_agent` as a prompt-based pseudo-tool
with the marker `<send_to agent="...">...</send_to>`. MCP transport
arrives in Phase 8.**

The choice mirrors ADR 0005 deliberately: same transport for
`<remember>` and `<send_to>` keeps the per-turn extractor logic
uniform, and the Phase 8 migration becomes "swap two markers for two
MCP tools" instead of two separate refactors.

## Marker syntax

The tag must occupy the entire line — same rule as `<remember>`,
same parser scaffolding:

```
<send_to agent="Atlas">tell Atlas to handle the migration script</send_to>
```

The `agent` attribute is required and resolves against `Agent.name`
(case-insensitive). On no-match, the broker writes a `failed` row
with reason `unknown_recipient` and does not retry.

## Mechanics

1. Per-turn buffering, identical to `<remember>`. Scan on
   `TurnComplete`, never on individual `text_delta` events.
2. Lines that match the marker are stripped from the cleaned
   assistant text (so the recipient name doesn't leak into the
   sender's chat history) and returned alongside any
   `ExtractedMemory`s.
3. The `Broker` is invoked once per extracted message:
   - Resolves `agent` name to id.
   - Computes depth (parent depth + 1, where parent depth is the
     `origin_human_message_id`'s chain length so far).
   - If depth > MAX_DEPTH (8 for Phase 4), writes a `failed` row
     with reason `loop_guard` and returns an error to the sender's
     next-turn tool result channel.
   - Otherwise writes a `pending` row, then enqueues onto the
     recipient's broker mpsc.
4. Recipient supervisor pops the message, marks the row
   `delivered`, and feeds it as a synthetic user turn to the
   recipient's Claude Code subprocess. The user-message JSON
   carries `{ from_agent_id, text }` so the renderer can show
   "from Atlas" rather than "user".
5. Once the recipient's next turn completes, the row is updated
   to `acknowledged`. The flight animation in the UI ends here.

## Edge cases

- **Marker discussed mid-prose.** Per the on-its-own-line rule
  (inherited from ADR 0005), an agent answering "what's the
  send_to syntax?" with `<send_to agent="X">...</send_to>` mid-
  sentence does not invoke the tool.
- **Self-send.** Agent A emitting `<send_to agent="A">...` is
  rejected with `failed: self_send` — the sender's id matches the
  recipient's. No infinite-self-loop concern.
- **Unknown recipient.** Failed row written with
  `reason: unknown_recipient`. The sender is told via an
  in-conversation system note on its next turn.
- **Recipient terminated.** Failed row written with
  `reason: recipient_unavailable`.
- **Mid-turn delivery.** If the recipient is currently processing
  a turn, the message is queued behind the active turn and
  delivered when the turn ends (backed by the recipient's
  broker mpsc).
- **Multiple sends in one turn.** Looped over independently, same
  pattern as multiple `<remember>` markers.

## Loop guard

The broker rejects when a chain of synthetic user turns since the
last human-originated message exceeds `MAX_DEPTH = 8`. Tracked via
the `origin_human_message_id` column on `inter_agent_messages` plus
the `depth` column. Cheap, deterministic, no rate-limit timer
state.

8 is conservative: long collaborative chains get lots of room, but
two agents bouncing pings cap out fast. Adjust once we see real
usage.

## Tradeoffs

- **Same as ADR 0005.** Determinism is weaker than MCP because the
  model could forget the marker; the system prompt is explicit and
  near-misses are logged.
- **Sender attribution lives in `messages.content` JSON, not as a
  schema field.** Phase 5+ may need to lift this if attribution
  becomes structurally important.
- **No per-message rate limiting.** Phase 4 relies on the loop
  guard alone. Phase 7's task system will introduce token-budget-
  aware throttles.

## Alternatives considered

- **MCP server now.** Rejected — same scope reasoning as ADR 0005.
  Phase 8 will migrate both `<remember>` and `<send_to>` together.
- **Send-by-id rather than send-by-name.** Rejected — agents in the
  prompt know their teammates by name, not UUID. Names are unique
  per Phase 2's spawn-dialog flow; a future collision policy is a
  follow-up.

## Consequences

- A new module `agents::send_to` (parallel to `agents::remember`)
  hosts the line-anchored extractor.
- `agents::remember::extract_memories` is generalised: the per-turn
  pass returns `(cleaned_text, Vec<ExtractedMemory>, Vec<ExtractedSendTo>)`
  so callers iterate the assistant text once. Internal helper module
  shares the line-iteration scaffolding.
- A new `Broker` type in `broker/` owns per-agent mpsc senders and
  the depth computation; `core::AppState` gains a `broker` handle
  alongside the existing `engine` and `supervisor`.

## Expiration

Revisit when Phase 8's MCP infrastructure lands. Migration mirrors
ADR 0005: drop the `<send_to>` marker docs from the system prompt,
replace the per-turn line extractor with an MCP `tool_use` handler.
Database schema (`inter_agent_messages`) and frontend behavior do
not change.
