---
description: Run the full verification suite — lint, typecheck, test — across the workspace via turbo. Use before declaring work complete.
allowed-tools: Bash(pnpm lint:*), Bash(pnpm typecheck:*), Bash(pnpm test:*), Bash(turbo run:*)
---

Run the full check pipeline. Stop at the first failure and report the failing command verbatim — do not paraphrase errors.

```bash
pnpm lint && pnpm typecheck && pnpm test
```

If any step fails:

1. Report the failing command and the first ~20 lines of error output.
2. Do NOT auto-fix unless the user asks. The user runs `/check` to learn the state of the tree, not to trigger edits.
