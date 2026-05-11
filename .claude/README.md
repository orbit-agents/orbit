# `.claude/` — project Claude Code configuration

This folder is checked into git and shared by every contributor using Claude Code on the Orbit repo. It is the project-scoped counterpart to your personal `~/.claude/` config.

## What's here

```
.claude/
├── settings.json          Project permissions, env vars (allow-list of safe commands; deny-list of secret files)
├── agents/                Project subagents — invoke with the Agent tool
│   ├── phase-guard.md     Enforces phase discipline + non-negotiable rules from CLAUDE.md
│   ├── rust-reviewer.md   Reviews Rust against Orbit conventions (thiserror/anyhow split, tracing, module boundaries)
│   └── ts-strict-checker.md   Reviews TS/React against strict-mode rules + design tokens
├── commands/              Slash commands — invoke as /<name>
│   ├── check.md           lint + typecheck + test
│   ├── test.md            scoped test runner (workspace, package, or test name)
│   ├── lint.md            eslint + clippy
│   ├── typecheck.md       tsc --noEmit across the workspace
│   ├── adr.md             scaffold a new ADR under docs/decisions/
│   └── tauri-dev.md       pnpm -F @orbit/desktop tauri:dev
└── skills/                Project skills — invoked via the Skill tool
    ├── orbit-conventions/SKILL.md   Fast-recall index of CLAUDE.md's non-negotiable rules
    └── writing-an-adr/SKILL.md      Guide for writing ADRs in this repo
```

## How permissions work

`settings.json` declares an `allow` list of safe commands (pnpm/cargo/git read-only/gh-read) so contributors don't get prompted constantly, and a `deny` list that blocks destructive shell commands and reads of secret files (`.env`, SSH keys, PEMs). Personal overrides go in `.claude/settings.local.json` (gitignored).

## Adding new entries

- **New subagent** → drop a `*.md` file in `agents/` with the standard frontmatter (`name`, `description`, `tools`, `model`). Then add a one-liner to CLAUDE.md's `.claude/` reference section.
- **New slash command** → drop a `*.md` file in `commands/` with `description` and `allowed-tools` frontmatter. The filename (sans `.md`) becomes the slash command name.
- **New skill** → create `skills/<name>/SKILL.md` with `name` + `description` frontmatter.

Keep these tight — they get loaded into context.
