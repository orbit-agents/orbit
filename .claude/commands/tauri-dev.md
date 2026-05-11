---
description: Start the Tauri desktop app in development mode (Vite + Rust core).
allowed-tools: Bash(pnpm tauri:*), Bash(pnpm -F:*)
---

```bash
pnpm -F @orbit/desktop tauri:dev
```

Run in the foreground so the user can see live logs. If the user wants it backgrounded, they can interrupt and rerun with `run_in_background`.
