# ADR 0010 — Phase 8: group threads on broker, terminal, MCP, deferred pseudo-tool migration

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

Phase 8 ships three subsystems together:

1. **Group threads** — multi-agent + human conversations.
2. **Terminal tab** — xterm.js bound to a per-agent PTY for ad-hoc
   shell work.
3. **MCP servers** — user-registered external tool servers passed to
   Claude Code via `--mcp-config`.

Plus an open thread from ADRs 0005, 0006, and 0009: each said the
prompt-based pseudo-tool path (`<remember>`, `<send_to>`, `<task>`)
would migrate to MCP "in Phase 8 when MCP infrastructure lands."
This ADR closes that out.

## Decisions

### 1. Group threads piggy-back on the broker

When the human posts to a group:

- Persist a `group_messages` row (`sender_kind = 'human'`).
- Emit `group:message_appended`.
- For each member, call `broker.enqueue_group_turn(...)` which adds a
  new `QueuedTurn::FromGroup { thread_id, content }` variant to the
  same per-agent inbox the broker already serializes.

The recipient's `run_group_turn` persists a synthetic user-role
message in the agent's conversation log (annotated with
`fromGroupId`) and runs the turn. On `TurnComplete` the cleaned
assistant text is mirrored back into `group_messages` as a
`sender_kind = 'agent'` row. Pseudo-tool extraction (`<remember>`,
`<send_to>`, `<task>`) still runs normally — the marker text is
stripped from the cleaned reply, and the structured side effects fire
in their usual paths.

**Why piggy-back:** the broker's per-agent FIFO already solves the
concurrency question (Phase 5's race fix). Adding a fourth transport
would be more code with no gain.

**No `<post_to_group>` marker.** The recipient's normal assistant
output is what gets posted. A separate marker would force agents to
explicitly opt into replying, which makes group conversation feel
stilted. If we ever need agent-side side-channel replies (e.g.
"I'm working on it but let me think first"), that's a future ADR.

### 2. Terminal is a right-panel tab, one PTY per (agent × open tab)

Right-panel tabs grow to four: `Chat | Settings | Diff | Terminal`.
The Terminal tab spawns a `portable-pty` PTY rooted at the agent's
`working_dir` on mount and tears it down on unmount. xterm.js
renders. Backend events (`terminal:data`, `terminal:exit`) stream
chunks; `terminal_write` sends keystrokes back; `terminal_resize`
syncs the grid.

**Why a tab and not a center-pane mode:** terminals get used
alongside the chat ("look at what the agent printed; now type a
command"), so co-locating them with the chat makes more sense than
swapping the canvas.

**Why no backgrounding:** Phase 8 ships the simple model. Closing
the tab kills the PTY. The user can reopen and gets a new shell. If
this becomes annoying we add a `keep_alive` setting in a follow-up.

### 3. MCP servers are per-agent config files

The user registers MCP servers in a top-level "MCP" view (a new
`centerView` value: `'mcp-settings'`). Each server has a
`is_default` flag; when an agent spawns, every default server gets
written into a per-agent JSON file at
`<data-dir>/mcp/<agent-id>.json`, and Claude Code is launched with
`--mcp-config <path>`.

**Why per-agent files instead of a shared one:** different agents
may need different toolsets, or different env (e.g. an `OPENAI_KEY`
unique to one agent). Per-agent files mean we can vary the config
without affecting siblings. The cost — one small JSON write per
spawn — is negligible.

**Why default-flag opt-in instead of "all servers, all the time":**
some MCP servers are situational (a database connector for one
project's agents only). Defaults give the user control without
forcing a per-agent picker UI in Phase 8.

**Updates to the MCP server list don't propagate to live agents.**
A respawn picks up the change. Phase 9+ could add hot-reload via
`SIGHUP` or process re-spawn; not worth the engineering for Phase 8.

### 4. Pseudo-tool → MCP migration is deferred

ADRs 0005 (`<remember>`), 0006 (`<send_to>`), 0009 (`<task>`) all
documented an "expiration" trigger: "revisit when Phase 8 MCP
infrastructure lands." With Phase 8 shipping, the question is
whether to actually migrate now.

**Decision: defer.** The pseudo-tools work. Migrating means rewriting
three flows (extractor → MCP tool handler), and users gain nothing
visible — the tools behave identically. Phase 8 already has three new
subsystems; adding a fourth refactor risks shipping less of each.

The migration plan, captured here so it doesn't get lost:

1. Build a small in-process MCP server (`agents::mcp_server` module)
   that exposes `remember`, `send_to`, and `task` as tools.
2. Append it as a default `--mcp-config` entry whenever Orbit
   spawns an agent (separate from user-configured MCP servers).
3. Drop the `### Using the * tool` subsections from the system
   prompt.
4. Replace the line-anchored extractors in `agents::extract` with
   `tool_use` event handlers in the `claude_code` engine path.
5. Database schema, frontend behavior, and the broker contract do
   not change.

Estimated effort: one engineer-week of focused work. Triggers for
revisiting:

- Reliability: if pseudo-tool determinism degrades (model forgets
  the marker too often), MCP becomes value-creating not just
  refactor.
- Phase 9+ gives us another opportunity to bundle this with other
  Claude Code surface changes.

## Tradeoffs

- **Group threads pollute per-agent chat history.** When the human
  posts in a group, every member gets a synthetic user message in
  its individual conversation. Acceptable for transparency
  ("here's everything this agent saw"); the chat panel renders the
  `fromGroupId` annotation so the user can tell.
- **Terminal restart loses scrollback.** Closing and reopening the
  tab gets a fresh PTY. Phase 8 doesn't snapshot history. A small
  inconvenience users will learn quickly.
- **MCP config rewrites on every spawn.** No caching. Fine —
  defaults rarely change and serializing a dozen-entry JSON is
  microseconds. If we ever have hundreds of default servers we'll
  optimize.

## Alternatives considered

- **Group threads via a separate `group_broker`.** Rejected — see
  above.
- **Terminal as a center-pane view.** Rejected — see above.
- **Single shared MCP config file.** Rejected — see above.
- **Migrate pseudo-tools now.** Rejected — three subsystems is
  enough; the open ADRs document the path.

## Consequences

- Migration `0008_groups_mcp.sql` adds four new tables.
- `agents::turn::run_group_turn` is a third entrypoint alongside
  `run_user_turn` and `run_inbound_turn`.
- `Broker::enqueue_group_turn` joins `enqueue_user_turn` and
  `dispatch` as the third place that pushes to a per-agent inbox.
- `SpawnConfig` grows `mcp_config_path: Option<PathBuf>`. Empty when
  no default servers are configured; populated by
  `commands::write_agent_mcp_config` on the spawn path.
- A new `terminal::TerminalRegistry` module owns per-agent PTYs.
  AppState gains `terminals: SharedTerminalRegistry`.
- The right-panel tab strip grows from three to four tabs; the
  sidebar Workspace nav grows from two rows (Canvas, Tasks) to three
  (Canvas, Tasks, MCP).

## Expiration

This ADR's group-broker decision and terminal model are stable —
they describe Phase 8's shipping shape and won't change without a
new ADR. The pseudo-tool migration deferral is the live thread:
revisit at the start of any future phase that touches Claude Code's
tool surface.
