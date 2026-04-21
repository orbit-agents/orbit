# Orbit

**Your AI agents, in orbit around your work.**

![status](https://img.shields.io/badge/status-pre--alpha-orange) ![license](https://img.shields.io/badge/license-MIT-blue)

Orbit is a cross-platform desktop workspace where you manage teams of AI coding agents that communicate and coordinate with each other. Individual AI agents are powerful; a coordinated team of them is transformative. Orbit gives them a shared spatial canvas where they talk, hand off work, and build persistent context.

> **Pre-alpha — actively being built.** Phase 0 (foundation) is complete. See [`docs/phases.md`](docs/phases.md) for the roadmap.

## Quick start

### Prerequisites

- **Node.js 20+** (see [`.nvmrc`](.nvmrc))
- **pnpm 10+** (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Rust stable** (via [rustup](https://rustup.rs))
- **Claude Code CLI** installed and authenticated — see [docs.claude.com/claude-code](https://docs.claude.com/claude-code)
- **Tauri 2 system deps** — follow [v2.tauri.app/start/prerequisites](https://v2.tauri.app/start/prerequisites). On Linux this means packages like `webkit2gtk-4.1`, `libssl-dev`, `libgtk-3-dev`, `librsvg2-dev`.

### Install and run

```bash
pnpm install
pnpm --filter @orbit/desktop tauri:dev
```

The first `tauri:dev` run compiles the Rust backend and can take several minutes; subsequent runs are fast.

## Project structure

```
orbit/
├── apps/
│   └── desktop/            Tauri app — React frontend + Rust backend
│       ├── src/            React UI
│       └── src-tauri/      Rust core (agents, broker, db, git, ipc)
├── packages/
│   ├── config/             Shared ESLint + tsconfig presets
│   ├── types/              Shared domain types
│   └── ui/                 Shared React component library
├── docs/
│   ├── architecture.md     Three-layer architecture in detail
│   ├── phases.md           Build roadmap (Phase 0 … Phase 8)
│   └── decisions/          Architecture Decision Records
└── .github/workflows/      CI + release
```

## Contributing

Read [`CLAUDE.md`](CLAUDE.md) first — it is the canonical guide for both human and AI contributors. It covers architecture, conventions, the design system, phase discipline, and non-negotiable rules. See also [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](LICENSE).
