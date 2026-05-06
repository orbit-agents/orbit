# ADR 0005 — The `remember` tool: prompt-based pseudo-tool, not MCP (yet)

- **Status:** Accepted
- **Date:** 2026-04-25

## Context

Phase 3 introduces persistent agent memory. A core requirement is that agents
themselves can append to memory mid-conversation — when the user corrects
them, when they discover a codebase convention, when they make a decision
worth carrying forward. The user-facing name for this is the `remember`
tool.

Two implementations were on the table:

1. **MCP server.** Build a Rust in-process or sidecar MCP server that
   exposes a `remember` tool over stdio. Wire each Claude Code subprocess
   to that server via `--mcp-config`. The tool call surfaces in the
   normal `tool_use` / `tool_result` stream, gets persisted, and we
   broadcast a memory event to the UI.
2. **Prompt-based pseudo-tool.** Document a `<remember>...</remember>`
   marker in the system prompt. Parse those markers out of the assistant
   text stream as it arrives, persist, and broadcast — the agent never
   "calls a tool," it just emits a marker that we strip before display.

## Decision

**For Phase 3, ship the prompt-based pseudo-tool. Migrate to MCP in
Phase 8 when MCP infrastructure is the headlining feature.**

## Rationale

- **Phase 3 scope is already heavy.** Identity (soul, purpose, memory),
  per-entry editing UI, identity-dirty injection on session resume, and
  CLAUDE.md import are the core deliverables. Adding an in-process MCP
  server with stdio transport, lifecycle management per agent, and an MCP
  protocol implementation is a meaningful slice on its own — it would
  push the dogfood test ("agent self-corrects via memory") two or three
  weeks further out.
- **The pseudo-tool is observable end-to-end.** The marker shows up in
  the raw assistant text stream. Easy to log, easy to test, easy to
  debug — no IPC across a stdio boundary that we own.
- **Phase 8 needs MCP anyway.** The premise of Phase 8 is "agents can
  use third-party tools via MCP." That phase will introduce a real MCP
  client/server stack; rolling our own in-house tooling on top of it
  becomes the natural shape. Building MCP twice — once as a shim for
  `remember`, once as the real thing — is wasted work.
- **The contract is the same either way.** A future migration from
  pseudo-tool to MCP changes the mechanism, not the surface: `remember`
  still takes `(content: string, category?: string)` and still persists
  to the agent's memory bucket. UI, DB schema, and Tauri events are
  unchanged across the migration.

## Mechanics

### Marker syntax

System prompt instructs the model to emit:

```
<remember>the thing to remember</remember>
```

**The tag must occupy the entire line — nothing else before or after on
the same line.** This rule is what makes parsing safe when the agent
_discusses_ the marker (e.g. answering a question like "what's the
remember syntax?" — in that case the marker appears mid-prose, with
quotes or other content on the line, and the parser correctly ignores
it). Models follow this rule reliably when it's stated explicitly in
the prompt; the false-positive cost of a chattier rule (require a
`category=` attribute, etc.) outweighs the rare miss.

### Parse timing

Buffer assistant text per turn and scan on `TurnComplete` — never on
individual `TextDelta` events. This handles two real-world failure
modes for free:

1. **Streamed token splits.** A model may emit `<remem` in one delta
   and `ber>...</remember>` in the next. Per-turn buffering means the
   parser only ever sees the assembled text.
2. **Atomic turn semantics.** A turn either completes with its
   memories saved, or it errors and saves none. No half-saved memories
   on a dropped connection.

After the turn completes:

1. Extract every line that matches `^<remember>(.+)</remember>$` (after
   trimming surrounding whitespace).
2. For each match, call `insert_memory_entry` with `source = 'agent'`.
3. Strip those lines from the text persisted into the `messages` table
   so the UI never re-renders the marker.
4. Emit an `agent:memory_added` Tauri event per saved entry so the
   Memory list animates them in live.

Edge cases handled:

- **Multiple markers in one turn.** Loop until no more matches.
- **Malformed marker** (unclosed, content empty after trim). Drop
  silently — never crash the stream.
- **Length cap (8 KB).** Truncate with a one-line note appended.
- **Marker discussed mid-prose.** Per the on-its-own-line rule, ignored.

## Tradeoffs

- **Determinism is weaker than MCP.** The model could theoretically
  forget to emit the marker, or emit it at the wrong moment. Mitigation:
  the system prompt is explicit, and we log near-misses (e.g.
  "I'll remember that" in plain text without a marker) for telemetry.
- **No structured arguments.** MCP would let us pass `category` as a
  separate field; the marker form requires either a separate
  `<remember category="...">...</remember>` syntax or living without
  categories from the agent side. Phase 3 punts on agent-supplied
  categories — only humans set categories in this phase.
- **Larger system prompt.** The protocol section adds ~80 tokens to
  every agent's system prompt. Acceptable tax for the simplicity gained.

## Alternatives considered

- **MCP server now.** Rejected — see scope rationale above.
- **JSON tool-use injection via Claude Code's `--allowed-tools`.**
  Claude Code does not currently expose a way to register custom tool
  handlers without an MCP server, so this is functionally identical to
  option 1.
- **Ask the agent to write to a file we then watch.** Cute but fragile,
  and breaks once we have git worktrees in Phase 6.

## Consequences

- A new `agents::stream_json::remember_extractor` (or an extension of
  the existing parser) lives next to the text-delta path.
- The `MemoryEntry` `source` column is load-bearing: it lets the UI
  show users that the agent saved this entry on its own. That visual
  trust signal is a feature.
- When Phase 8 lands and we migrate to MCP, the only files that change
  are inside `agents::` — DB schema, Tauri commands, frontend, and
  events stay put. A follow-up ADR will document the migration.

## System prompt injection mode

Phase 3 invokes Claude Code with `--append-system-prompt`. Our identity
block (Soul + Purpose + Memory + the `Using the remember tool`
subsection) layers on top of Claude Code's built-in system prompt,
which means the model still gets the default tool documentation for
Read / Edit / Bash / Grep / etc. for free.

Phase 8 (MCP) will switch to `--system-prompt` (full replacement) once
Orbit's own MCP server exposes the equivalent tools. At that point the
default Claude Code prompt becomes a duplicate of our own and we cut
it.

**Migration trigger:** when the Orbit MCP server exposes Read / Edit /
Bash / Grep equivalents and the default Claude Code prompt becomes
redundant, swap `--append-system-prompt` for `--system-prompt` in
[`agents::claude_code`](../../apps/desktop/src-tauri/src/agents/claude_code.rs)
and append the tool docs to our own `SystemPromptBuilder` output.

## Known follow-ups

- **Skip redundant `<system_update>` blocks on resume.** Rehydration sets
  `identity_dirty = true` so a resumed agent reliably picks up any
  identity edits made while the app was closed. If no edits were made,
  the next user turn carries an update block whose contents are
  byte-identical to what the model already has — semantically a no-op
  but a small token tax. Cheap fix: stash a `last_injected_prompt_hash`
  on the agent and short-circuit when it matches. Track-and-revisit if
  redundant injections show up in token telemetry; otherwise leave it.

## Expiration

**This ADR will be revisited when Phase 8's MCP infrastructure lands.**
At that point the prompt-based marker becomes technical debt that we
will pay down by replacing the marker with a proper MCP tool call.

Migration path:

- Drop the `Using the remember tool` subsection from the system prompt.
- Replace the per-turn text scanner in `agents::stream_json` with a
  handler in the `tool_use` event path.
- Database schema (`memory_entries`, `source = 'agent'`) does not change.
- Frontend (Memory list, source indicators, `agent:memory_added`
  events) does not change.
- Estimated effort: one engineer-day, plus a fresh dogfood pass.

Until Phase 8 ships, the prompt-based path is the supported
implementation. New tooling that follows the same shape (e.g. a
hypothetical `note_to_self`) should also use the marker convention so
the eventual migration touches one place.
