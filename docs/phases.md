# Development phases

Orbit is built in phases. Each phase ships a usable artifact — something a developer can actually run and use, not a scaffold. **Do not build ahead of the current phase.**

## Phase 0 — Foundation · _Complete_

Repo scaffold, three-panel shell, design tokens, CI.

## Phase 1 — One agent end-to-end · _Complete_

Spawn a single Claude Code subprocess, stream output to a chat panel, persist conversations in SQLite.

### Manual test checklist

1. **Spawn flow.** Click the `+` next to "Agents". Pick a name, emoji, color, and working directory. Click Spawn. The agent appears; the chat panel shows its header and an empty body.
2. **First message.** Type "list the files in this folder" in the chat input. Press Cmd/Ctrl+Enter. Assistant text streams in; a tool-call card appears with a ✓ when the tool returns.
3. **Tool call rendering.** Click the tool-call card; it expands to input + result. Click again to collapse.
4. **Restart persistence.** Close the app; reopen. The agent is still listed and the full conversation history is visible.
5. **Missing CLI.** Set `ORBIT_CLAUDE_PATH=/nope`; relaunch. You see the setup view with install instructions, not a crash.
6. **Termination.** Close the app while streaming. Confirm no orphan `claude` processes remain (`ps aux | grep claude`).
7. **Empty message.** Send button stays disabled; the command rejects empty input.
8. **Cross-platform.** Same flow on macOS, Windows, and Linux (requires `webkit2gtk-4.1`).

## Phase 2 — Canvas + multiple agents · _Complete_

React Flow canvas with multiple agent nodes; each agent is an independent Claude Code subprocess with its own conversation, draft, and scroll state; selection syncs across canvas/sidebar/right panel.

**Deliverable:** launch the app, double-click an empty spot on the canvas to spawn agents, drag them around, switch between their chats, and close + reopen with positions and conversations intact.

### Manual test checklist

1. **Multi-spawn.** Double-click five different empty spots on the canvas; fill in the dialog each time. Five nodes appear at the clicked positions.
2. **Independent conversations.** Send "hello A" to the first agent. Switch to the second and send "hello B". Switch back — the first agent still shows its own history; no bleed.
3. **Drag + persist.** Drag each agent to a new position. Close the app, reopen — every agent is where you left it (snapped to 20px grid).
4. **Pan-to-selected.** Click an agent in the sidebar DMs list. Canvas smoothly pans to center on that agent.
5. **Status ring.** Send a long prompt to an agent, switch to another mid-stream. The first agent's node ring pulses green on the canvas even while you're looking at a different chat.
6. **Waiting-for-human heuristic.** Ask the agent a question the model is likely to bounce back with a question mark. Its node shows the amber `?` badge and the ring goes amber.
7. **Double-click → Settings.** Double-click a node. The right panel switches to Settings; Rename works end-to-end.
8. **Right-click menu.** Right-click a node. Focus chat, Rename, and Terminate all work. Terminate removes the subprocess (`ps aux | grep claude`).
9. **10-agent cap.** Try to spawn an 11th agent. The toast-style error message explains the limit.
10. **60fps pan/zoom.** Open DevTools > Performance; pan around aggressively with ten agents visible. Frame rate stays ≥ 50fps.
11. **Draft preservation.** Type a partial message in agent A's input, switch to agent B, switch back. The partial is still there.
12. **Scroll preservation.** Scroll halfway up in agent A's chat, switch to B, switch back. Scroll position is restored.
13. **Escape deselects.** Select an agent, press Escape. Selection clears.
14. **Cmd/Ctrl+Shift+N.** Opens the spawn dialog at the viewport center.
15. **Cross-platform.** Same flow on macOS, Windows, and Linux.

## Phase 3 — Agent identity + memory · _Complete_

Soul / Purpose / Memory fields on the agent. System prompt built by templating these three plus global context. Memory is persistent, editable by the human, and writable by the agent itself via a `<remember>` pseudo-tool.

**Deliverable:** edit an agent's Soul / Purpose, watch it speak in that voice on the next message; correct it once and watch it save the correction to memory and not repeat the mistake; close the app and reopen — identity and memory survive.

### Manual test checklist

1. **Identity persona.** Edit Soul to "I always use TypeScript strict mode and prefer `unknown` over `any`." Send a message asking for a function that takes JSON input. Verify the result reflects the soul.
2. **Identity-pending pill.** Edit Soul; observe the amber "Identity pending" pill in the right-panel header. Send a message; the pill clears once the next turn fires.
3. **Live identity update.** Change Soul to "I prefer pragmatic JS — `any` is fine for prototypes." Send another message. Next response reflects the new soul (and you can confirm the `<system_update>` block shows up if you peek at the raw prompts).
4. **Agent self-correction.** Tell the agent "remember that we use Tailwind v3, not v4." A new entry with the bot icon appears at the top of the Memory list with a brief accent highlight that fades.
5. **Memory persistence across restart.** Tell the agent "remember the table is `usres` not `users`." Quit the app, wait, reopen. Send a query about the users table. The agent uses `usres`.
6. **Memory edit.** Edit a memory entry inline (pencil → edit → Save). Send a new message. The agent's response reflects the edited memory.
7. **Memory delete.** Delete an entry. The "Identity pending" pill appears. Send a new message — the model no longer references the deleted fact.
8. **CLAUDE.md import (toggle off).** Spawn a new agent in a directory containing a `CLAUDE.md`. The Purpose stays empty. No memory entry created.
9. **CLAUDE.md import (toggle on).** Flip the Advanced > "Import CLAUDE.md on spawn" toggle. Spawn a new agent. Purpose now contains the file's contents; an "imported" memory entry notes the source path.
10. **Import now button.** For an already-spawned agent, drop a `CLAUDE.md` into its working dir, click "Import now". Same effect.
11. **Memory cap.** Add 60 memory entries via the Add memory button. The system prompt only includes the 50 most recent (verify if peeking at prompts), but all 60 are visible in the UI.
12. **Long memory truncation.** Have the agent emit a `<remember>` marker with > 8KB content (you may need to coax it). The entry is saved with a `[…truncated by Orbit at 8KB]` suffix and the Rust logs show a `tracing::warn!` line.
13. **Marker discussion safety.** Ask the agent "what's the syntax of the remember tool?" — the agent's reply mentions `<remember>...</remember>` mid-prose; verify no spurious memory entry is created.
14. **Cross-platform.** Same flow on macOS, Windows, and Linux.

## Phase 4 — Agent-to-agent messaging · _In Progress_

Broker implementation, `send_message_to_agent` tool exposed to agents, canvas animations for in-flight messages. Messaging is audited in the DB. V1 Ledger design system applied across the app: ink/line scale tokens, accent green, Geist Sans, OrbitMark logo in the title bar.

**Deliverable:** ask agent A to delegate something to agent B, watch the message arc fly across the canvas to B's node, see it appear in B's chat as a "from Atlas" bubble, and verify the audit log captures the round trip.

### Manual test checklist

1. **Spawn two agents.** Agent A in working dir X, Agent B in working dir Y.
2. **Outbound `<send_to>` succeeds.** Tell A "ask Bee to count the files in their working directory". A's response includes a `<send_to agent="Bee">...</send_to>` marker that gets stripped from A's chat. The Inbox section in A's Settings tab shows the dispatched message.
3. **Canvas flight animation.** A green dashed arc appears between A's node and B's node, animating with flow direction toward B. The arc disappears when B's turn completes (acknowledged status).
4. **Inbound bubble in B's chat.** B's chat shows a left-aligned "from Atlas" bubble with A's emoji, color, and the message text — distinct from a human user message.
5. **Self-send rejection.** Have A try to message itself. The Inbox shows a `failed` row tagged `self_send`.
6. **Unknown recipient.** Have A try to message an agent that doesn't exist. The Inbox shows a `failed` row tagged `unknown_recipient`. A console warning fires.
7. **Loop guard.** Stage A → B → A → B → … with a question that bounces. After ~8 hops the broker rejects the next dispatch with `depth_exceeded`.
8. **Audit log persists across restart.** Send a few messages between agents. Quit the app, reopen. The Inbox section still shows them.
9. **Teammate roster appears in prompt.** Spawn a second agent while A is running. A's next turn includes a "Your teammates" section in its system prompt addendum (you can verify by editing A's Soul to provoke an `<system_update>` and inspecting the next message).
10. **Cross-platform.** Same flow on macOS, Windows, and Linux.

## Phase 5 — Teams + folder access · _Complete_

Canvas team regions (visual groupings with derived bounds — see ADR 0007). Per-agent folder allowlist passed to Claude Code via `--add-dir` at spawn and validated at any IPC command that touches the filesystem on the agent's behalf.

**Deliverable:** group three agents into a "Payments" team, drop a fourth into the team region by drag, click the team in the sidebar to pan to it, allowlist a shared `lib/` directory across two agents, and verify both agents can read it while a third (without the allowlist) cannot.

### Manual test checklist

1. **Create a team.** Click `+` next to the Teams section header in the sidebar. Type "Payments", press Enter. The team appears with a color swatch and `0` member count.
2. **Drag-into-team.** Drag two agents so their centers land inside the (default placeholder) Payments region. Each agent's `team_id` is persisted; the team's member count goes to `2`. The region's dashed rectangle now hugs the two agents with 16px padding and a mono-uppercase "PAYMENTS" label at the top-left.
3. **Drag-out-of-team.** Drag one of the two agents far away from the region. On drag-end the agent is removed from the team; the region tightens around the remaining member.
4. **Click-to-pan.** Click the team row in the sidebar. The canvas smoothly pans/zooms to fit the team's member region with 25% padding.
5. **Empty-team placeholder.** Drag both agents out of the team. The region falls back to a 240×120 placeholder near the origin and is still clickable in the sidebar.
6. **Restart persistence.** Quit the app, reopen. Teams + memberships are restored exactly.
7. **Folder access — add.** Open the agent's Settings → Folder access. Click "Add folder", pick `~/shared/lib`. The folder appears in the list as a row with a remove button. Re-spawn the agent (or restart the app) and verify Claude Code received it via `--add-dir` (peek at the spawn args in the Rust log).
8. **Folder access — remove.** Hover the row, click the X. The folder is removed from the list. Working dir is never listed (it's the read-only "always allowed" row at the top).
9. **Folder access enforcement.** With agent A's working dir at `~/api` and no extra allowlist, place a `CLAUDE.md` at `~/lib/CLAUDE.md` and call "Import now" — it should fail with the user-facing "outside this agent's allowed folders" error. Add `~/lib` to the allowlist; the same import succeeds.
10. **Cross-platform.** Same flow on macOS, Windows, and Linux. Folder paths are canonicalized server-side; allowlists deduplicate symlinked or relative entries.

## Phase 6 — Git isolation · _Planned_

## Phase 6 — Git isolation · _Planned_

One git worktree per agent, one branch per agent. `git2`-based worktree manager. UI surfaces per-agent diff.

## Phase 7 — Tasks + status reports + sticky notes · _Planned_

Agents maintain a task list. Periodic status reports posted to a shared channel. Sticky notes placeable on the canvas for human annotation.

## Phase 8 — Group conversations + terminal + MCP · _Planned_

Group threads (multiple agents + human). xterm.js terminal tab for ad-hoc shell work. MCP server support so agents can use third-party tools.

## Beyond Phase 8

Out of scope until after Phase 8 ships: cloud sync, hardware sandboxing, roles system, manager agents, custom MCP authoring, mobile companion.
