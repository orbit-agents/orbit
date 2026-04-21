//! SQLite persistence.
//!
//! - Schema is defined via `sqlx` migrations in `migrations/`.
//! - All queries are async and use compile-time checked `sqlx::query!` macros
//!   where practical.
//! - Migrations must be versioned and idempotent (see CLAUDE.md rule 8).
//!
//! Phase 1 lands the first migration with `agents`, `conversations`, `messages`.
