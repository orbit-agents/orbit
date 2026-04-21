# Architecture

Orbit is three layers connected by two sharp boundaries.

```
┌─────────────────────────────────────────────────────────────┐
│                     UI (React, Tauri webview)                │
│         Canvas · Sidebar · Chat · Settings · Tabs            │
└─────────────────────────────┬───────────────────────────────┘
                              │   Tauri IPC (commands + events)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Core  (Rust, Tauri backend)              │
│                                                             │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌────────┐   │
│   │  core::  │   │ broker:: │   │  agents::│   │ ipc::  │   │
│   │supervise │◀──│  routes  │──▶│ registry │──▶│commands│   │
│   └────┬─────┘   │  audits  │   │  spawn   │   └────────┘   │
│        │         └────┬─────┘   │  pipe IO │                │
│        │              │         └────┬─────┘                │
│        ▼              ▼              ▼                      │
│   ┌──────────┐   ┌──────────┐   ┌──────────────────┐        │
│   │   db::   │   │   git::  │   │     AgentEngine   │       │
│   │  sqlx    │   │ worktree │   │     (trait)       │       │
│   └──────────┘   └──────────┘   └────────┬──────────┘        │
└──────────────────────────────────────────┼──────────────────┘
                                           │ stdin/stdout
                                           ▼
                              ┌────────────────────────┐
                              │  Agent workers          │
                              │  (claude CLI procs)     │
                              │  each in its own dir    │
                              └────────────────────────┘
```

## The two boundaries

### 1. UI ↔ Core: Tauri IPC

The UI never touches filesystem, git, SQLite, or agent processes directly. Everything flows through Tauri commands (request/response) and Tauri events (core → UI push). This keeps the UI testable in isolation and the core authoritative about state.

### 2. Core ↔ Agent: `AgentEngine` trait

Every agent subprocess is wrapped by an implementation of the `AgentEngine` trait (see [`apps/desktop/src-tauri/src/agents/mod.rs`](../apps/desktop/src-tauri/src/agents/mod.rs)). The current implementation wraps the Claude Code CLI. Future implementations can wrap the Anthropic API directly, another CLI, or a local model — without touching any code outside `agents::`.

## Message flow: agent → agent

This is the most load-bearing path in the system. Every step is deliberate.

```
Agent A wants to talk to Agent B
           │
           ▼
Agent A calls `send_message_to_agent` tool
           │  (emitted on stdout as tool call)
           ▼
agents:: parses the tool call
           │
           ▼
broker:: receives { from: A, to: B, content }
   ├─ logs to db::
   ├─ applies rate limit
   ├─ emits `message-in-flight` to UI
   │      (canvas shows animated dot A → B)
   ▼
broker:: forwards to agents::send(B, …)
           │
           ▼
agents:: writes to B's stdin on B's next turn
```

The UI can see every message, every tool call, every pause. Nothing hidden.

## Persistence

SQLite, one file per map (`~/.orbit/maps/<id>.db`). Schema is versioned via `sqlx migrate`; migrations are idempotent and never edited once merged. Tables (as of Phase 1 design): `agents`, `conversations`, `messages`, `tasks`, `teams`, `folders`. Full schema will be documented in ADRs as it stabilizes.

## Process supervision

`core::` owns a supervisor that monitors each agent subprocess. On crash, it re-spawns with exponential backoff, re-hydrating Soul + Purpose + Memory from SQLite. A three-strikes-within-a-minute policy pauses the agent and surfaces the failure to the UI.

## Filesystem access control

Each agent has a `folderAccess: string[]` allowlist. The core refuses filesystem operations outside that list. This is enforced at the core boundary — agents never touch the filesystem directly, they go through IPC to the core which checks.

## Cross-platform notes

- macOS: standard Tauri bundle; signed with Apple Developer cert in release.
- Windows: MSI installer; we expect PTY work in Phase 8 to need the ConPTY path.
- Linux: AppImage; depends on `webkit2gtk-4.1` being present.

Anything platform-specific must be gated with `cfg(target_os = ...)` and have a fallback or graceful degradation.
