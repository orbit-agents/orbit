//! Git worktree manager.
//!
//! Each agent gets its own worktree and branch so their edits don't collide.
//! Uses `git2` (libgit2 bindings). Phase 6 implements this.
