---
description: Run TypeScript typecheck across the workspace (no emit).
allowed-tools: Bash(pnpm typecheck:*), Bash(turbo run:*)
---

```bash
pnpm typecheck
```

Report the first failing file:line and the diagnostic. Do not paraphrase TypeScript errors — they are precise.
