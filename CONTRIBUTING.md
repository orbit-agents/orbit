# Contributing to Orbit

Thanks for your interest in Orbit. Before you write code, please read [`CLAUDE.md`](CLAUDE.md) — it is the authoritative reference for architecture, conventions, and phase discipline for both human and AI contributors.

## Getting set up

See the **Quick start** section in [`README.md`](README.md).

## Pull requests

1. Branch from `main`: `git checkout -b feat/my-change`.
2. Keep the change scoped to a single concern.
3. Write or update tests — Rust unit tests colocated with source, TypeScript Vitest tests in `*.test.ts` next to the code.
4. Run `pnpm lint && pnpm typecheck && pnpm test` and the Rust equivalents (`cargo fmt --check`, `cargo clippy`, `cargo test`) locally before pushing.
5. Open a PR against `main`.

## Commit messages

We use **[Conventional Commits](https://www.conventionalcommits.org/)**. Examples:

- `feat(canvas): add agent node component`
- `fix(broker): serialize concurrent sends`
- `chore: bump Tauri to 2.3.0`
- `docs(adr): choose SQLite over SQLCipher for now`

Subject lines imperative, under 72 chars. Commitlint enforces this via a git hook.

## Phase discipline

Orbit is built in phases (see [`docs/phases.md`](docs/phases.md)). **Do not build ahead of the current phase.** If something belongs to a later phase, leave a `// TODO(phase-N)` marker and move on. This keeps review focused and prevents half-finished systems.

## Architecture Decision Records

For non-trivial architectural choices, write a short ADR in [`docs/decisions/`](docs/decisions/) following the pattern of the existing files. An ADR is not a bureaucracy — it is a record that future contributors can use to understand _why_ a decision was made.

## Code of conduct

Be kind, assume good faith, and critique code rather than people.
