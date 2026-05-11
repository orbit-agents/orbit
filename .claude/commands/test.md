---
description: Run tests. With no arg, runs the whole workspace; with an arg, filters to that package or test path.
allowed-tools: Bash(pnpm test:*), Bash(pnpm -F:*), Bash(cargo test:*), Bash(turbo run:*)
argument-hint: '[package or path]'
---

If `$ARGUMENTS` is empty, run `pnpm test` from the repo root.

Otherwise:

- If the argument looks like a workspace name (`@orbit/desktop`, `desktop`, `types`, `ui`, `config`), run `pnpm -F <name> test`.
- If the argument looks like a path under `apps/desktop/src-tauri`, run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml $ARGUMENTS`.
- If the argument looks like a TS file or test name, run `pnpm -F @orbit/desktop test -- $ARGUMENTS`.

Report failures with the first failing test name and its assertion, not the whole log.
