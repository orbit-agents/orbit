# ADR 0001 — Tauri 2 over Electron

- **Status:** Accepted
- **Date:** 2026-04-22

## Context

Orbit is a desktop app that runs multiple long-lived subprocesses, holds large amounts of state in memory (agent histories, canvas geometry), and needs to feel native. The two realistic options for the shell are **Electron** and **Tauri 2**.

## Decision

Use **Tauri 2**.

## Rationale

- **Binary size.** Tauri produces ~10–20 MB installers vs ~120 MB+ for Electron. Orbit is going to be installed by developers who are sensitive to bloat.
- **Memory.** Tauri uses the OS webview (WebKit on macOS, WebView2 on Windows, WebKitGTK on Linux) instead of bundling Chromium. At rest, Orbit's memory footprint will be dominated by agent subprocesses anyway — the shell doesn't need to pile on.
- **Rust core.** The parts of Orbit that must be reliable (process supervisor, broker, DB, git) benefit from Rust's guarantees. Electron would force us to write that layer in Node with a native-addon escape hatch.
- **Security model.** Tauri's capabilities system is more granular than Electron's main/renderer split. We get fine-grained command allowlisting out of the box.

## Tradeoffs

- **Smaller ecosystem.** Electron has more prior art and plugins. We accept this — our integration surface is deliberately small and most of our needs are covered by crates.
- **Webview differences.** Safari on macOS, WebView2 on Windows, WebKitGTK on Linux — three webviews, three sets of quirks. We mitigate with Playwright smoke tests on all three in CI and by sticking to well-supported CSS.
- **Hiring.** Rust is a higher bar than Node. We accept this — the core is small and stable by design; most contributor effort will land in the React UI.

## Alternatives considered

- **Electron.** Rejected for the reasons above.
- **Native per-platform.** Way too much duplicate effort for an open-source project in Phase 0.
- **Web-only PWA.** Can't spawn subprocesses, can't touch the filesystem meaningfully. Non-starter for this product.
