//! Core: process supervisor, lifecycle, and app-wide state.
//!
//! Owns the top-level `AppState` struct that the UI commands read and write
//! through, and the supervisor that restarts crashed agent subprocesses.
//! Phase 1 begins populating this.
