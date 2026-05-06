# ADR 0008 — Per-agent git worktrees: libgit2, data-dir storage, pinned diff base

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

Phase 6 ships git isolation: each agent that lives inside a Git
repository works on its own branch in its own worktree, so two agents
editing the same repo can't corrupt each other's progress and the
human can review what each agent has done as a self-contained diff.

Three load-bearing decisions:

1. **What library?** libgit2 bindings (`git2`) vs. shelling out to
   the user's `git` binary.
2. **Where do worktrees live?** Inside the source repo (next to the
   user's checkout) vs. in Orbit's data directory.
3. **What is the diff base?** The source repo's _current_ HEAD at
   render time vs. the commit the worktree was branched from.

Plus a UX call: what do we do when the source repo has uncommitted
changes at spawn time?

## Decision

1. **`git2` for everything.** No subprocess `git` calls.
2. **Worktrees live in `<orbit-data-dir>/worktrees/<agent-id>`**, not
   adjacent to the source repo.
3. **Diff base is pinned at create time** — `agents.worktree_base_ref`
   stores the commit hash, and `WorktreeManager::diff` always uses
   that hash regardless of where the source repo's HEAD has moved
   since.
4. **Spawning into a dirty source repo is refused.** The user must
   commit or stash first. Returns a typed `WorktreeError::DirtyBase`
   that the IPC layer surfaces as a clear human-facing message.

## Rationale

### libgit2 over `git` subprocess

- **Cross-platform parity.** `git2` ships native libgit2; behavior is
  identical on macOS / Windows / Linux. Shelling out introduces
  variance (different `git` versions, locale-dependent stderr
  formats, missing binaries on Windows).
- **Typed errors.** `git2::Error` has stable error codes. Parsing
  stderr is fragile and we'd end up doing string matching on
  human-readable text.
- **Already in the dependency tree.** `git2 = "0.19"` was added in
  Phase 0 — adopting it now costs nothing.

### Data-dir worktrees

- **Don't pollute the source repo.** Some users have `git worktree
list` setups already in their projects; sharing that namespace
  would surprise them.
- **Survives source-repo moves.** If the user moves the source repo,
  the worktree's `gitdir` link in `.git/worktrees/<name>/` already
  breaks — but at least Orbit's per-agent dirs are still in our data
  dir for cleanup.
- **Single root for cleanup.** `<data-dir>/worktrees/` is the one
  directory we own. Easy to nuke if the user wants a fresh start.

### Pinned diff base

- **Stable review surface.** "What did agent X do" should mean the
  same thing regardless of when you ask. Pinning the base to the
  commit at create-time gives that property.
- **Source-repo rebases don't lie.** Without pinning, if the user
  rebases `main` after spawning the agent, the agent's diff
  retroactively grows or shrinks based on unrelated changes upstream.
  Confusing and wrong.
- **Phase 6 doesn't auto-rebase the agent's branch.** That's a Phase
  7+ concern. Pinned base means the agent's branch can fall behind
  the source repo without breaking the diff view.

### Dirty-base refusal

Two options were on the table:

- (a) Refuse to spawn — "your base branch has uncommitted changes;
  commit or stash first."
- (b) Spawn anyway — the worktree starts from the same dirty state.

We picked (a). Rationale: (b) leaves us debugging "why does my
agent's diff show changes I didn't make" later, and the user almost
always wants the dirty changes to remain in _their_ checkout, not
silently propagate to every spawned agent.

The check uses libgit2's `Repository::statuses()` with `WT_*` and
`INDEX_*` flags — anything that would survive a `git stash` counts
as dirty.

## Mechanics

- **Branch name:** `orbit/<slug>-<short-id>` where `<slug>` is the
  agent name lowercased + non-alphanumerics collapsed to dashes, and
  `<short-id>` is the first 8 characters of the agent UUID.
- **Worktree name (libgit2 internal):** the agent id directly. Slashes
  in the _branch_ name are fine; libgit2's worktree directory inside
  `.git/worktrees/<name>/` doesn't tolerate slashes, so the worktree
  identifier and the branch name diverge.
- **Cleanup:** `agent_delete` calls `manager.remove(..., delete_branch=true)`,
  which prunes the libgit2 metadata, deletes the worktree directory,
  and (best-effort) removes the branch. `agent_terminate` only stops
  the subprocess; the worktree + branch survive so the human can
  still review the work.

## Tradeoffs

- **Source repo can't be deleted while agents reference it.** If the
  user moves or deletes the source repo, the agent's worktree links
  break. We surface "not_a_repo" errors and the diff view shows
  empty. Acceptable; this is the same failure mode the user would
  see with native `git worktree`.
- **No auto-rebase.** As noted, Phase 7+ concern. Currently if the
  user wants to fold their main-branch changes into the agent's
  branch, they do it manually (or via Claude Code in the agent's own
  shell).
- **One worktree per agent forever.** Re-spawning an agent that was
  deleted with the same id is rejected at the path-exists check. The
  caller must use a fresh agent id (which they will, since ids are
  UUID v4).

## Alternatives considered

- **`git` subprocess.** Rejected for cross-platform variance and
  stderr parsing fragility.
- **Worktrees inside the source repo.** Rejected because we'd be
  modifying directories the user might have their own `git worktree`
  setup in.
- **Diff base = source repo HEAD at render time.** Rejected because
  it makes the per-agent diff drift on source-repo rebases.
- **Spawn-anyway-on-dirty.** Rejected — see above.

## Consequences

- New `git/` module owns all libgit2 interaction. Outside callers go
  through `WorktreeManager` only.
- `agents` table grows five columns (`has_worktree` + 4
  `worktree_*`); migration 0006 adds them. All optional except
  `has_worktree` which defaults to 0 so Phase 1 agents survive.
- `agent_spawn` becomes a two-phase operation: insert agent row →
  detect git repo → maybe create worktree → write worktree metadata.
  If the worktree step fails, the spawn rolls back and the agent
  never appears.
- `agent_delete` must call `manager.remove` before the row drops or
  the worktree is orphaned. Rehydration is read-only and doesn't
  touch the worktree.
- The Diff tab on the right panel reads `manager.diff(worktree_path,
base_ref)` directly each time it's opened. Phase 6 doesn't cache
  diffs; the libgit2 call is fast enough.

## Expiration

Revisit when one of these happens:

- The user wants to commit on the agent's behalf automatically (Phase
  7 task system) → ADR for auto-commit cadence.
- The diff view needs syntax highlighting or word-level diff →
  rendering ADR, doesn't change the manager API.
- Source-repo changes need to flow into agent branches automatically
  → ADR for auto-rebase / merge-from-base.
- We outgrow `<data-dir>/worktrees/` (e.g. monorepo agents with
  10GB checkouts) → ADR for sparse-checkout or shallow worktrees.
