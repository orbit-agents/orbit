# CLAUDE.md

This file guides AI coding assistants (especially Claude Code) working on the Orbit codebase. Read this completely before making changes.

## What Orbit is

Orbit is a cross-platform desktop workspace where developers manage teams of AI coding agents that communicate and coordinate with each other. The core thesis is simple: individual AI agents are powerful, but a coordinated team of them is transformative. Orbit gives agents a shared spatial canvas where they hand off work, talk through problems, and accumulate persistent context — with full transparency and auditability for the human in the loop.

## Architecture at a glance

Orbit is three layers:

1. **Core (Rust / Tauri backend)** — the conductor. Owns the agent registry, message broker, SQLite database, git worktree manager, process supervisor, and filesystem access control. Everything that must be reliable lives here.
2. **Agent workers (subprocesses)** — each agent is a `claude` CLI process running in its own working directory with stdin/stdout piped to the core. The core injects a system prompt built from Soul + Purpose + Memory on every turn.
3. **UI (Tauri webview / React)** — canvas, sidebar, chat. Stateless relative to the core; subscribes to events, sends commands.

**Load-bearing rule:** inter-agent messaging goes through the core broker, never directly between agents. This gives transparency, auditability, rate-limiting, and replay. Violating this rule collapses most of Orbit's value.

## Repository layout

```
orbit/
├── apps/
│   └── desktop/            Tauri app — React frontend + Rust backend
│       ├── src/            React UI (components, hooks, stores, styles)
│       └── src-tauri/      Rust core (agents, broker, db, git, ipc, core)
├── packages/
│   ├── config/             Shared ESLint + tsconfig presets
│   ├── types/              Shared domain types (@orbit/types)
│   └── ui/                 Shared React components + `cn()` utility
├── docs/
│   ├── architecture.md     Three-layer architecture in detail
│   ├── phases.md           Build roadmap (Phase 0 … Phase 8)
│   └── decisions/          Architecture Decision Records
└── .github/workflows/      CI + release pipelines
```

## Tech stack and why

| Choice                             | Why                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| **Tauri 2** (vs Electron)          | Smaller binaries, native performance, memory-safe core in Rust. See ADR 0001.           |
| **React 18 + TypeScript strict**   | Mature ecosystem for the canvas-heavy UI; strict mode catches bugs early.               |
| **Vite**                           | Fast dev server, first-class TS/React support, plays well with Tauri's dev flow.        |
| **Tailwind v3**                    | Design tokens as CSS variables; discourages one-off CSS; fast iteration.                |
| **@xyflow/react (React Flow)**     | Canvas primitive we'd otherwise have to build. Declarative, battle-tested.              |
| **Zustand**                        | Simple cross-tree UI state without Redux ceremony.                                      |
| **@tanstack/react-query**          | Async state — invalidation, caching, optimistic updates — without reinventing it.       |
| **lucide-react**                   | Consistent icon set, tree-shakable.                                                     |
| **clsx + tailwind-merge (`cn()`)** | Conditional class names with conflict resolution.                                       |
| **react-resizable-panels**         | Three-panel layout with drag-to-resize, persists to storage.                            |
| **Tokio**                          | De facto async runtime for Rust; required by most of our deps.                          |
| **sqlx** (SQLite)                  | Compile-time checked queries; async; no ORM overhead.                                   |
| **uuid v4**                        | Stable IDs for agents, messages, conversations.                                         |
| **tracing + tracing-subscriber**   | Structured logs and future distributed tracing.                                         |
| **thiserror + anyhow**             | `thiserror` at library boundaries, `anyhow` in application code (see conventions).      |
| **git2 (libgit2)**                 | Native git operations without spawning `git` subprocesses.                              |
| **portable-pty**                   | Cross-platform PTY for the Phase 8 terminal tab.                                        |
| **async-trait**                    | Needed for `AgentEngine` and other core traits until stable async-in-traits catches up. |
| **Claude Code CLI** (as engine)    | See ADR 0002.                                                                           |

Before adding a new top-level dependency, check this table first and justify the addition in your PR description.

## Coding conventions

### TypeScript

- Strict mode, no `any`, prefer `unknown` + narrowing.
- `noUncheckedIndexedAccess: true` is on — handle `possibly undefined` explicitly.
- Named exports over default exports (except React components).
- File names: `kebab-case` for utilities/hooks, `PascalCase.tsx` for components.
- Imports: absolute via `@/` alias for within-app; package names for workspace packages (`@orbit/types`, `@orbit/ui`).
- Use `import type { Foo }` for type-only imports.

### React

- Functional components + hooks only.
- Colocate component + styles + tests: `Foo.tsx`, `Foo.test.tsx`.
- Prefer composition over prop drilling; use Zustand stores for cross-tree state.
- No inline styles — Tailwind classes, or `cva` variants once we add it.
- Keyboard shortcuts go through `useKeyboardShortcut`; don't attach raw listeners.

### Rust

- Use `thiserror` for library errors (structured, typed); `anyhow` for application / top-level error handling.
- All public functions and modules documented with `///` doc comments.
- `tracing` for logs — never `println!` in production paths.
- Async everywhere via Tokio; no blocking calls in async contexts (`tokio::task::spawn_blocking` if you must).
- Module boundaries: `core::`, `agents::`, `db::`, `git::`, `broker::`, `ipc::`. Keep them honest — no cross-module leaks.
- Formatter: `rustfmt` with the repo's `rustfmt.toml`. Clippy set to deny warnings in CI.

### Commits

- **Conventional Commits**: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `perf:`, `build:`.
- Imperative mood, subject line under 72 chars, no trailing period.
- Commitlint enforces on commit (`.husky/commit-msg`).

## Design system

Full tokens live in [`apps/desktop/tailwind.config.ts`](apps/desktop/tailwind.config.ts) and [`apps/desktop/src/styles/globals.css`](apps/desktop/src/styles/globals.css). Quick reference:

- **Colors** (dark mode defaults, via CSS variables): `bg-app`, `bg-panel`, `bg-elevated`, `bg-hover`; `border`, `border-subtle`; `text-primary`, `text-secondary`, `text-tertiary`; `accent` (#5E6AD2); `status-active` / `status-waiting` / `status-error`.
- **Typography:** Inter (UI) and JetBrains Mono (code). Allowed sizes: `text-11`, `text-12`, `text-13`, `text-14`, `text-16`, `text-20`, `text-28`. Don't introduce others.
- **Spacing:** only `4, 8, 12, 16, 20, 24, 32, 48` px — in Tailwind, that's `1, 2, 3, 4, 5, 6, 8, 12`. Don't use arbitrary values.
- **Radius:** `rounded-input` (6 px) for inputs, `rounded-button` / `rounded-card` (8 px), `rounded-panel` (12 px) for panels and modals.
- **Motion:** use `duration-fast` (120 ms) for hovers, `duration-base` (180 ms) for most transitions, `duration-slow` (260 ms) for layout. Ease-out for entrances, ease-in for exits.

## Development phases — what to build and what NOT to build yet

We build in phases. **Do not get ahead of the current phase.** Each phase ships a usable artifact.

- **Phase 0 — Foundation:** Repo scaffold, three-panel shell, design tokens, CI. _[current]_
- **Phase 1 — One agent end-to-end:** Spawn a single Claude Code subprocess, stream output to a chat panel, persist conversations in SQLite.
- **Phase 2 — Canvas + multiple agents:** React Flow canvas, spawn from "+" button, per-agent nodes with status rings.
- **Phase 3 — Agent identity + memory:** Soul / Purpose / Memory persisted and injected into system prompts.
- **Phase 4 — Agent-to-agent messaging:** Broker, `send_message_to_agent` tool, message-flight animations.
- **Phase 5 — Teams + folder access:** Canvas team regions, per-agent folder permissions.
- **Phase 6 — Git isolation:** git worktrees per agent, branch per agent.
- **Phase 7 — Tasks + status reports + sticky notes:** Task lists, sticky notes on canvas, help flags.
- **Phase 8 — Group conversations + terminal + MCP:** Group threads, xterm.js terminal tab, MCP server support.

### What we are explicitly NOT building yet

- Cloud sync
- Hardware sandboxing / VMs
- Roles system (just a tag, defer)
- Manager agents that spawn other agents
- Custom MCP server authoring
- Mobile companion app
- Authentication beyond Claude Code's own auth

## Non-negotiable rules

1. **Do not add features ahead of the current phase.** If a feature belongs to Phase 5 and we are on Phase 2, do not build it — leave a `// TODO(phase-5)` and move on.
2. **All inter-agent messaging goes through the core broker.** Never have agents talk to each other directly over any channel.
3. **Never send real messages to the Anthropic API from tests.** Mock the `AgentEngine` trait.
4. **Cross-platform from day one.** Every Rust feature must work on macOS, Windows, and Linux. If it uses platform-specific APIs, gate them with `cfg(target_os = ...)` and provide fallbacks.
5. **No feature lands without tests.** Rust: unit tests colocated with source. TS: Vitest, colocated `.test.ts`. Integration tests in `apps/desktop/tests/`.
6. **The `AgentEngine` trait is the boundary.** Core code talks to agents only through this trait. Current implementation wraps Claude Code CLI; future implementations may wrap other engines.
7. **Errors are structured.** Never stringly-typed error handling. Define error enums (`thiserror`) at library boundaries.
8. **SQLite migrations are versioned and idempotent.** Use `sqlx migrate`. Never edit a merged migration — write a new one.

## Keyboard shortcuts (reserved)

| Shortcut     | Action             | Lands in |
| ------------ | ------------------ | -------- |
| `Cmd/Ctrl+B` | toggle sidebar     | Phase 0  |
| `Cmd/Ctrl+J` | toggle right panel | Phase 0  |
| `Cmd/Ctrl+E` | toggle canvas      | Phase 0  |
| `Cmd/Ctrl+K` | command palette    | Phase 1  |
| `Cmd/Ctrl+L` | focus chat input   | Phase 1  |
| `Cmd/Ctrl+N` | new map            | Phase 2  |
| `Cmd/Ctrl+,` | settings           | Phase 1  |

## When you are unsure

- If an architectural choice isn't covered here, write an ADR in `docs/decisions/` _before_ implementing.
- If a request seems to cross a phase boundary, stop and ask.
- If you're about to add a new top-level dependency, check it against the stack table first and justify it in your response.
- If something is inconsistent between the code and this document, trust the code and update this document in the same PR.

## `.claude/` reference

The repo ships a project-scoped Claude Code config under [`.claude/`](.claude/README.md). Use it instead of reinventing the workflow each session.

**Settings**

- [`.claude/settings.json`](.claude/settings.json) — Allow-list for safe `pnpm` / `cargo` / `git` / `gh` commands and a deny-list for destructive shell ops and secret files. Personal overrides go in `.claude/settings.local.json` (gitignored).

**Subagents** (`.claude/agents/`, invoke via the `Agent` tool)

- [`phase-guard`](.claude/agents/phase-guard.md) — Verifies a change does not get ahead of the current build phase (see [`docs/phases.md`](docs/phases.md)) and respects the non-negotiable rules above. Run before landing non-trivial work.
- [`rust-reviewer`](.claude/agents/rust-reviewer.md) — Reviews Rust against the conventions in this file (`thiserror` / `anyhow` split, `tracing`, module boundaries, cross-platform gates).
- [`ts-strict-checker`](.claude/agents/ts-strict-checker.md) — Reviews TS/React against strict-mode rules and the design-token allow-list.

**Slash commands** (`.claude/commands/`)

- [`/check`](.claude/commands/check.md) — `pnpm lint && pnpm typecheck && pnpm test`. The "is the tree green?" command.
- [`/test`](.claude/commands/test.md) — Scoped test runner (workspace, package, or test name).
- [`/lint`](.claude/commands/lint.md) — ESLint + `cargo clippy`.
- [`/typecheck`](.claude/commands/typecheck.md) — `tsc --noEmit` across the workspace.
- [`/adr`](.claude/commands/adr.md) — Scaffold a new ADR under [`docs/decisions/`](docs/decisions/).
- [`/tauri-dev`](.claude/commands/tauri-dev.md) — Start the Tauri desktop app in dev mode.

**Project skills** (`.claude/skills/`, invoke via the `Skill` tool)

- [`orbit-conventions`](.claude/skills/orbit-conventions/SKILL.md) — Fast-recall index of the non-negotiable rules and design tokens. Load before coding.
- [`writing-an-adr`](.claude/skills/writing-an-adr/SKILL.md) — Guide for writing tight, decision-first ADRs in this repo.

## References

- Product inspiration: [pentagon.run](https://pentagon.run) (docs at [docs.pentagon.run](https://docs.pentagon.run))
- Canvas library: [React Flow (@xyflow/react)](https://reactflow.dev)
- Tauri 2 docs: <https://tauri.app>
- Claude Code: <https://docs.claude.com/claude-code>
- Project docs: [`docs/architecture.md`](docs/architecture.md), [`docs/phases.md`](docs/phases.md), [`docs/decisions/`](docs/decisions/)
- Project Claude Code config: [`.claude/README.md`](.claude/README.md)

## graphify

This project integrates [graphify](https://pypi.org/project/graphifyy/) — a knowledge graph (god nodes, community structure, EXTRACTED + INFERRED edges) used as a structural map of the codebase.

**One-time per-contributor setup** (the graph itself is gitignored; each developer builds locally):

```bash
pipx install graphifyy            # or pip install graphifyy
graphify extract . --backend openai   # ~$0.03 on this repo with OPENAI_API_KEY set
```

After that, the husky `post-commit` and `post-checkout` hooks rebuild the graph automatically (AST-only, no API cost) on every commit and branch switch.

Rules for the AI assistant:

- IF `graphify-out/GRAPH_REPORT.md` exists, ALWAYS read it before reading source files, running grep/glob searches, or answering codebase questions. The graph is your primary map.
- IF `graphify-out/wiki/index.md` exists, navigate it instead of reading raw files.
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse EXTRACTED + INFERRED edges instead of scanning files.
- If `graphify-out/` does not exist, the contributor hasn't built it yet — fall back to grep/glob and don't complain.
