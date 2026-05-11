---
description: Lint TS/React via ESLint and Rust via clippy. Reports issues without auto-fixing.
allowed-tools: Bash(pnpm lint:*), Bash(cargo clippy:*), Bash(turbo run:*)
---

Run both linters and surface findings.

```bash
pnpm lint
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --no-deps -- -D warnings
```

Report errors with file:line. If both pass, say "clean" — nothing else.
