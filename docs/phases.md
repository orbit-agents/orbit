# Development phases

Orbit is built in phases. Each phase ships a usable artifact — something a developer can actually run and use, not a scaffold. **Do not build ahead of the current phase.**

## Phase 0 — Foundation · _In Progress_

Repo scaffold, three-panel shell, design tokens, CI.

**Deliverable:** `pnpm --filter @orbit/desktop tauri:dev` opens an empty dark-mode shell with a sidebar, a dot-grid canvas area, and a right detail panel. Keyboard shortcuts toggle each panel. CI passes on all three platforms.

## Phase 1 — One agent end-to-end · _Planned_

Spawn a single Claude Code subprocess, stream output to a chat panel, persist conversations in SQLite.

**Deliverable:** click "New agent" → a `claude` subprocess starts in a chosen directory → you can chat with it from Orbit → the conversation persists across restarts.

## Phase 2 — Canvas + multiple agents · _Planned_

React Flow canvas, spawn from the "+" button on the canvas, per-agent nodes with status rings. Multiple agents run simultaneously, each with their own conversation.

## Phase 3 — Agent identity + memory · _Planned_

Soul / Purpose / Memory fields on the agent. System prompt built by templating these three plus global context. Memory is persistent and editable.

## Phase 4 — Agent-to-agent messaging · _Planned_

Broker implementation, `send_message_to_agent` tool exposed to agents, canvas animations for in-flight messages. Messaging is audited in the DB.

## Phase 5 — Teams + folder access · _Planned_

Canvas team regions (visual groupings with bounds). Per-agent folder allowlist enforced at the core IPC boundary.

## Phase 6 — Git isolation · _Planned_

One git worktree per agent, one branch per agent. `git2`-based worktree manager. UI surfaces per-agent diff.

## Phase 7 — Tasks + status reports + sticky notes · _Planned_

Agents maintain a task list. Periodic status reports posted to a shared channel. Sticky notes placeable on the canvas for human annotation.

## Phase 8 — Group conversations + terminal + MCP · _Planned_

Group threads (multiple agents + human). xterm.js terminal tab for ad-hoc shell work. MCP server support so agents can use third-party tools.

## Beyond Phase 8

Out of scope until after Phase 8 ships: cloud sync, hardware sandboxing, roles system, manager agents, custom MCP authoring, mobile companion.
