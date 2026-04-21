//! Tauri command handlers exposed to the frontend.
//!
//! Commands are the only way the UI interacts with core state. Everything is
//! async, returns structured errors, and is registered in `lib.rs::run`.
//! Phase 1 adds the first commands (`spawn_agent`, `send_message`).
