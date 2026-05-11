---
name: orbit-conventions
description: Use whenever about to write or modify code in the Orbit repo. Loads the load-bearing rules (broker-only messaging, AgentEngine boundary, phase discipline, design tokens, error-handling split) so the work matches Orbit's conventions on the first pass instead of after review.
---

# Orbit conventions — load before coding

This skill is a fast-recall index of the rules in `CLAUDE.md` that bite most often. Read the cited file for the canonical version; this file is a hint sheet, not a substitute.

## The five non-negotiables (full list in CLAUDE.md → "Non-negotiable rules")

1. **Phase discipline.** Do not implement features for a future phase. Use `// TODO(phase-N)` stubs. Current phase = highest phase marked complete in `docs/phases.md`.
2. **Broker-only messaging.** Agents never talk directly to other agents. Everything goes through the core broker — gives transparency, auditability, replay.
3. **`AgentEngine` is the boundary.** Core code calls agents only through this trait. The current impl wraps the Claude Code CLI; future impls may wrap other engines.
4. **Cross-platform from day one.** Platform-specific code uses `cfg(target_os = ...)` and has fallbacks for the other OSes.
5. **No real Anthropic API calls in tests.** Mock the `AgentEngine`.

## Error handling

- `thiserror` at **library boundaries** (typed enums per module).
- `anyhow` at the **application / top level** (after boundary crossings).
- Never `String`-typed errors at module boundaries.

## Design tokens — what's allowed

Source of truth: `apps/desktop/tailwind.config.ts` + `apps/desktop/src/styles/globals.css`.

- Font sizes: `text-11 | text-12 | text-13 | text-14 | text-16 | text-20 | text-28`. Nothing else.
- Spacing scale (Tailwind units): `1, 2, 3, 4, 5, 6, 8, 12` (= 4 px … 48 px). No arbitrary `p-[13px]`.
- Radius: `rounded-input` (inputs), `rounded-button | rounded-card` (8 px), `rounded-panel` (12 px).
- Motion: `duration-fast` (120 ms) hovers, `duration-base` (180 ms) most, `duration-slow` (260 ms) layout.
- Color tokens only: `bg-app`, `bg-panel`, `bg-elevated`, `bg-hover`, `border`, `border-subtle`, `text-primary/secondary/tertiary`, `accent`, `status-active/waiting/error`.

## Module boundaries (Rust core)

`core::`, `agents::`, `db::`, `git::`, `broker::`, `ipc::`. No cross-reaching — if you find yourself wanting to, the boundary is wrong and needs an ADR.

## Migration discipline

`sqlx migrate` writes versioned files. **Never edit a merged migration.** Write a new one that corrects forward.

## When you're unsure

- An architectural choice not covered here or in CLAUDE.md → run `/adr <title>` to scaffold an ADR before coding.
- Something inconsistent between code and `CLAUDE.md` → trust the code, update `CLAUDE.md` in the same PR.
- A request appears to cross a phase boundary → stop and ask.
