# ADR 0003 — One long-lived `claude` subprocess per agent

- **Status:** Accepted
- **Date:** 2026-04-22

## Context

Claude Code's `--print --output-format stream-json --input-format stream-json --verbose` mode can be run two ways:

1. **Per-turn spawn.** Each user message is a fresh `claude` process that reads one message off stdin, streams events, and exits. Subsequent turns use `--resume <session_id>` to keep context.
2. **Long-lived process.** One `claude` process per agent stays alive. User messages are newline-delimited JSON lines written to the subprocess's stdin; events stream back on stdout indefinitely. The process exits when stdin closes or on explicit termination.

The Phase 1 spec prescribes the exact flag set and also describes a "supervisor" with an mpsc channel for user messages, a BufReader loop over stdout, and graceful SIGTERM-then-SIGKILL. That wording only fits option 2.

## Decision

Use **one long-lived `claude` subprocess per agent**, not a fresh process per turn.

## Rationale

- **Latency.** A cold `claude` start on a developer's machine is roughly 300–800 ms. A long-lived process hides that cost once per agent lifetime instead of on every turn.
- **Session state.** We still need `session_id` for cross-restart resumption (captured from the first `system/init` event, stored in SQLite), but intra-session we lean on in-memory continuity.
- **Supervisor fits.** The per-agent supervisor, stderr ring buffer, graceful termination, and `kill_on_drop` semantics all presuppose a long-lived child. Per-turn spawn would make supervision awkward.
- **Spec alignment.** The Phase 1 spec's supervision design is explicit about this shape.

## Tradeoffs

- **Resource floor.** Each idle agent holds a process. With 20 agents that is ~20 Node processes. For Phase 1 (one agent) and Phase 2 (a handful) this is fine; Phase 3+ may warrant lazy shutdown after N minutes of idleness.
- **Stdin framing is load-bearing.** If we ever emit a user message without a trailing newline, the child blocks forever. The stdin writer in `claude_code.rs` always appends `\n` and flushes; any future protocol changes to `--input-format stream-json` need a matching update.
- **Turn boundaries are implicit.** We end each returned `send_message` stream when we see `TurnComplete` or `Error`. If Claude Code ever emits `result` without that shape, our stream won't close. We tolerate unknown event types in the parser but rely on `result` as the turn sentinel.

## Alternatives considered

- **Per-turn spawn with `--resume`.** Simpler lifecycle but adds 300–800 ms of latency to every message and complicates streaming (each turn has its own child). Rejected unless a future measurement shows the long-lived process leaks memory or misbehaves.
- **Anthropic API directly** (skip the CLI). Deferred to after `AgentEngine` has a second implementation; the Claude Code engine stays the default.

## Consequences

- `agents::claude_code::ClaudeCodeEngine` holds `Arc<Mutex<HashMap<AgentId, Arc<AgentProcess>>>>` — one process per agent.
- `AgentProcess` owns `Child`, an mpsc `stdin_tx`, a slot for the current turn's event receiver, and a stderr ring buffer.
- `agents::supervisor` is a broadcast fan-out for the UI; it does not own processes.
- `core::rehydrate_agents` runs on startup and re-spawns every persisted agent with `resume_session_id` set from its stored `session_id`.
