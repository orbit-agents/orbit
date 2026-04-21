# ADR 0002 — Claude Code CLI as the agent runtime

- **Status:** Accepted
- **Date:** 2026-04-22

## Context

An Orbit agent needs to: read and write files, run shell commands, call tools, maintain conversational context, and stream output token-by-token. We can build this ourselves on the raw Anthropic API, or we can reuse an existing agent runtime.

## Decision

Use the **Claude Code CLI** as the default agent runtime, invoked as a subprocess. Abstract it behind the `AgentEngine` trait so we can add alternatives later.

## Rationale

- **It already works.** Claude Code handles tool use, streaming, session management, and a usable set of filesystem/shell/MCP tools. Reimplementing that is months of work we would rather spend on Orbit-specific value (canvas, multi-agent coordination, personas, git isolation).
- **Users already have it.** Anyone who will want Orbit probably already has Claude Code installed and authenticated. We avoid re-doing auth and model access.
- **Subprocess isolation is a feature.** Each agent is a separate process with its own working directory. That maps cleanly to our design: one agent = one cwd = one git worktree.
- **Easy to replace.** Wrapping it behind `AgentEngine` keeps the option open to add a direct-API engine, a local-model engine, or a competing CLI. Phase 0 pins to Claude Code to stay focused.

## Tradeoffs

- **We don't own the prompt loop.** We can't mutate system prompts mid-turn. Mitigation: inject Soul + Purpose + Memory at turn start and let Claude Code own the loop.
- **We parse CLI output.** Tool calls and status need to be parsed from the subprocess's stdout stream. Mitigation: Claude Code supports a structured output mode (`--output-format stream-json`) that we'll use.
- **CLI versioning drift.** If Claude Code's output format changes, we must track it. Mitigation: pin a minimum version at startup and produce a clear error when the installed version is too old.

## Alternatives considered

- **Raw Anthropic API.** Rejected for Phase 0 — too much surface to rebuild before we can ship anything interesting. May become the basis of a second `AgentEngine` impl.
- **Other agent CLIs** (Cursor CLI, Aider, etc.). Deferred — each would be a second engine implementation, not a reason to avoid Claude Code as the first.
- **Roll-our-own tool loop.** Rejected; we are not in the business of building a general-purpose coding agent. We are building the coordination layer _around_ them.
