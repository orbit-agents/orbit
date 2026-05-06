//! Git worktree manager.
//!
//! Each agent gets its own worktree at
//! `<orbit-data-dir>/worktrees/<agent-id>` on a dedicated branch
//! (`orbit/<slug>-<short-id>`). The agent's `working_dir` becomes
//! that path so Claude Code (and any tool it spawns) sees a clean
//! tree it can edit, commit, and inspect without colliding with
//! teammates.
//!
//! libgit2-only — no shelling out to the user's `git` binary, so
//! behavior is uniform across macOS, Windows, and Linux.
//!
//! See ADR 0008 for the design notes (data-dir worktrees, pinned
//! diff base, dirty-base refusal).

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use git2::{
    BranchType, DiffOptions, ErrorCode, Repository, Status, StatusOptions, WorktreeAddOptions,
    WorktreePruneOptions,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum WorktreeError {
    #[error("git error: {0}")]
    Git(#[from] git2::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("the source repository at {0} has uncommitted changes; commit or stash before spawning an agent")]
    DirtyBase(PathBuf),
    #[error("could not detect a current branch on {0} (detached HEAD?)")]
    NoCurrentBranch(PathBuf),
    #[error("not a git repository: {0}")]
    NotARepo(PathBuf),
    #[error("worktree path already exists: {0}")]
    PathExists(PathBuf),
}

impl WorktreeError {
    /// Stable machine tag for surfacing to the frontend.
    pub fn tag(&self) -> &'static str {
        match self {
            Self::Git(_) => "git",
            Self::Io(_) => "io",
            Self::DirtyBase(_) => "dirty_base",
            Self::NoCurrentBranch(_) => "no_current_branch",
            Self::NotARepo(_) => "not_a_repo",
            Self::PathExists(_) => "path_exists",
        }
    }
}

/// One worktree's metadata. Returned from `create()` and persisted
/// onto the agent row.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: PathBuf,
    pub branch: String,
    /// Absolute path to the source repository this worktree was
    /// branched from.
    pub source_repo: PathBuf,
    /// Commit hash the worktree was branched from. Diffs use this as
    /// the stable base — see ADR 0008.
    pub base_ref: String,
    /// The branch name on the source repo we branched off (e.g.
    /// "main"). Useful in the UI for "branched from main".
    pub base_branch: String,
}

/// One file-level diff entry. Multiple `Hunk`s per file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub status: FileStatus,
    pub additions: u32,
    pub deletions: u32,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    /// Patch header text (e.g. `@@ -10,5 +10,7 @@`).
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub origin: char,
    pub content: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
}

/// Manager handle. Stateless beyond the `worktrees_dir` so it can be
/// shared as `Arc<WorktreeManager>` across the Tauri command surface.
pub struct WorktreeManager {
    /// Where this manager places worktrees, typically
    /// `<data-dir>/worktrees/`.
    worktrees_dir: PathBuf,
}

pub type SharedWorktreeManager = Arc<WorktreeManager>;

impl WorktreeManager {
    pub fn new(worktrees_dir: PathBuf) -> Self {
        Self { worktrees_dir }
    }

    /// True iff `path` is the root of (or sits inside) a Git
    /// repository.
    pub fn is_git_repo(path: &Path) -> bool {
        Repository::discover(path).is_ok()
    }

    /// Create a new worktree for the given agent off the source
    /// repo's currently-checked-out branch. Refuses to create if the
    /// source repo's working tree has uncommitted changes.
    pub fn create(
        &self,
        agent_id: &str,
        agent_name: &str,
        source_repo: &Path,
    ) -> Result<WorktreeInfo, WorktreeError> {
        let repo = Repository::discover(source_repo)
            .map_err(|_| WorktreeError::NotARepo(source_repo.to_path_buf()))?;
        let source_root = repo
            .workdir()
            .ok_or_else(|| WorktreeError::NotARepo(source_repo.to_path_buf()))?
            .to_path_buf();

        ensure_clean(&repo, &source_root)?;

        let head = repo.head()?;
        let base_branch = head
            .shorthand()
            .map(str::to_string)
            .ok_or_else(|| WorktreeError::NoCurrentBranch(source_root.clone()))?;
        let base_oid = head.peel_to_commit()?.id();
        let base_ref = base_oid.to_string();

        let worktree_path = self.worktrees_dir.join(agent_id);
        if worktree_path.exists() {
            return Err(WorktreeError::PathExists(worktree_path));
        }
        std::fs::create_dir_all(&self.worktrees_dir)?;

        let short_id: String = agent_id.chars().take(8).collect();
        let branch_name = format!("orbit/{}-{}", slugify(agent_name), short_id);

        let base_commit = repo.find_commit(base_oid)?;
        match repo.branch(&branch_name, &base_commit, false) {
            Ok(_) => {}
            Err(e) if e.code() == ErrorCode::Exists => {}
            Err(e) => return Err(e.into()),
        };
        let reference = repo
            .find_branch(&branch_name, BranchType::Local)?
            .into_reference();

        // Worktree name (used as a directory under `.git/worktrees/`)
        // must not contain slashes. Branch names freely can — keep
        // them separate.
        let worktree_name = worktree_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(agent_id)
            .to_string();

        let mut opts = WorktreeAddOptions::new();
        opts.reference(Some(&reference));
        repo.worktree(&worktree_name, &worktree_path, Some(&opts))?;

        Ok(WorktreeInfo {
            path: worktree_path,
            branch: branch_name,
            source_repo: source_root,
            base_ref,
            base_branch,
        })
    }

    /// Tear down a worktree. Best-effort: missing directories don't
    /// error; deleting the per-agent branch is opt-in (Phase 6
    /// passes `true` from `agent_delete`, leaves it for terminate).
    pub fn remove(
        &self,
        agent_id: &str,
        worktree_path: &Path,
        source_repo: &Path,
        branch_name: &str,
        delete_branch: bool,
    ) -> Result<(), WorktreeError> {
        let repo = Repository::discover(source_repo)
            .map_err(|_| WorktreeError::NotARepo(source_repo.to_path_buf()))?;

        let wt_name = worktree_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(agent_id);
        if let Ok(worktree) = repo.find_worktree(wt_name) {
            let mut opts = WorktreePruneOptions::new();
            opts.valid(true).working_tree(true);
            let _ = worktree.prune(Some(&mut opts));
        }

        if worktree_path.exists() {
            std::fs::remove_dir_all(worktree_path)?;
        }

        if delete_branch {
            if let Ok(mut branch) = repo.find_branch(branch_name, BranchType::Local) {
                let _ = branch.delete();
            }
        }
        Ok(())
    }

    /// Compute the diff between `base_ref` and the worktree's
    /// current state (HEAD + uncommitted modifications + untracked).
    pub fn diff(
        &self,
        worktree_path: &Path,
        base_ref: &str,
    ) -> Result<Vec<FileDiff>, WorktreeError> {
        let repo = Repository::open(worktree_path)
            .map_err(|_| WorktreeError::NotARepo(worktree_path.to_path_buf()))?;

        let base_oid = repo
            .revparse_single(base_ref)
            .or_else(|_| repo.revparse_single(&format!("{base_ref}^{{commit}}")))?
            .id();
        let base_tree = repo.find_commit(base_oid)?.tree()?;

        let mut opts = DiffOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true);

        let diff = repo.diff_tree_to_workdir_with_index(Some(&base_tree), Some(&mut opts))?;

        // libgit2's `foreach` takes three independent FnMut closures
        // that each want `&mut Vec<FileDiff>`. We can't borrow it
        // mutably three times at once, so wrap it in a RefCell and
        // borrow at call time.
        let files: RefCell<Vec<FileDiff>> = RefCell::new(Vec::new());

        diff.foreach(
            &mut |delta, _| {
                let new_path = delta
                    .new_file()
                    .path()
                    .map(|p| p.to_string_lossy().into_owned());
                let old_path = delta
                    .old_file()
                    .path()
                    .map(|p| p.to_string_lossy().into_owned());
                let path = new_path.clone().or(old_path).unwrap_or_default();
                files.borrow_mut().push(FileDiff {
                    path,
                    status: classify_status(delta.status()),
                    additions: 0,
                    deletions: 0,
                    hunks: Vec::new(),
                });
                true
            },
            None,
            Some(&mut |delta, hunk| {
                let path = delta
                    .new_file()
                    .path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let mut files = files.borrow_mut();
                if let Some(file) = files.iter_mut().find(|f| f.path == path) {
                    file.hunks.push(DiffHunk {
                        header: String::from_utf8_lossy(hunk.header()).into_owned(),
                        lines: Vec::new(),
                    });
                }
                true
            }),
            Some(&mut |delta, _hunk, line| {
                let path = delta
                    .new_file()
                    .path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let mut files = files.borrow_mut();
                if let Some(file) = files.iter_mut().find(|f| f.path == path) {
                    if let Some(h) = file.hunks.last_mut() {
                        let origin = line.origin();
                        if origin == '+' {
                            file.additions += 1;
                        } else if origin == '-' {
                            file.deletions += 1;
                        }
                        h.lines.push(DiffLine {
                            origin,
                            content: String::from_utf8_lossy(line.content()).into_owned(),
                            old_lineno: line.old_lineno(),
                            new_lineno: line.new_lineno(),
                        });
                    }
                }
                true
            }),
        )?;

        Ok(files.into_inner())
    }

    /// Current commit hash on the worktree's branch (HEAD).
    pub fn current_commit(&self, worktree_path: &Path) -> Result<String, WorktreeError> {
        let repo = Repository::open(worktree_path)
            .map_err(|_| WorktreeError::NotARepo(worktree_path.to_path_buf()))?;
        let head = repo.head()?;
        let commit = head.peel_to_commit()?;
        let hash = commit.id().to_string();
        Ok(hash)
    }
}

fn classify_status(status: git2::Delta) -> FileStatus {
    use git2::Delta;
    match status {
        Delta::Added => FileStatus::Added,
        Delta::Deleted => FileStatus::Deleted,
        Delta::Renamed => FileStatus::Renamed,
        Delta::Untracked => FileStatus::Untracked,
        _ => FileStatus::Modified,
    }
}

/// Refuse to spawn if the source repo has uncommitted changes —
/// otherwise the agent inherits unrelated edits and its diff view
/// is misleading. ADR 0008.
fn ensure_clean(repo: &Repository, source_root: &Path) -> Result<(), WorktreeError> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .include_ignored(false)
        .recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts))?;
    let dirty = statuses.iter().any(|s| {
        let f = s.status();
        !f.intersection(
            Status::WT_NEW
                | Status::WT_MODIFIED
                | Status::WT_DELETED
                | Status::WT_TYPECHANGE
                | Status::WT_RENAMED
                | Status::INDEX_NEW
                | Status::INDEX_MODIFIED
                | Status::INDEX_DELETED
                | Status::INDEX_TYPECHANGE
                | Status::INDEX_RENAMED,
        )
        .is_empty()
    });
    if dirty {
        return Err(WorktreeError::DirtyBase(source_root.to_path_buf()));
    }
    Ok(())
}

fn slugify(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_dash = false;
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "agent".to_string()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn init_repo(dir: &Path) {
        let run = |args: &[&str]| {
            let status = Command::new("git")
                .args(args)
                .current_dir(dir)
                .status()
                .expect("git should be installed");
            assert!(status.success(), "git {args:?} failed");
        };
        std::fs::create_dir_all(dir).unwrap();
        run(&["init", "-b", "main"]);
        run(&["config", "user.email", "test@orbit.dev"]);
        run(&["config", "user.name", "Test"]);
        std::fs::write(dir.join("README.md"), "hello\n").unwrap();
        run(&["add", "."]);
        run(&["commit", "-m", "init"]);
    }

    #[test]
    fn slugify_handles_punctuation_and_unicode() {
        assert_eq!(slugify("Scout 🛰️"), "scout");
        assert_eq!(slugify("Hello, World!"), "hello-world");
        assert_eq!(slugify("---"), "agent");
        assert_eq!(slugify("API · v2"), "api-v2");
    }

    #[test]
    fn create_worktree_then_diff_then_remove() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source");
        let worktrees = dir.path().join("worktrees");
        init_repo(&source);

        let mgr = WorktreeManager::new(worktrees.clone());
        let info = mgr
            .create("agent-12345678", "Scout", &source)
            .expect("worktree create");

        assert!(info.path.starts_with(&worktrees));
        assert!(info.branch.starts_with("orbit/scout-agent-12"));
        assert_eq!(info.base_branch, "main");
        assert!(info.path.join("README.md").exists());

        // Initial diff: nothing yet.
        let empty = mgr.diff(&info.path, &info.base_ref).unwrap();
        assert!(empty.iter().all(|f| f.hunks.is_empty()));

        // Modify a file in the worktree; diff now picks it up.
        std::fs::write(info.path.join("README.md"), "hello\nworld\n").unwrap();
        let diff = mgr.diff(&info.path, &info.base_ref).unwrap();
        assert!(diff
            .iter()
            .any(|f| f.path == "README.md" && f.additions > 0));

        // Untracked file gets flagged too.
        std::fs::write(info.path.join("new.txt"), "new\n").unwrap();
        let diff2 = mgr.diff(&info.path, &info.base_ref).unwrap();
        assert!(diff2.iter().any(|f| f.path == "new.txt"));

        // Remove tears down the worktree dir.
        mgr.remove(
            "agent-12345678",
            &info.path,
            &info.source_repo,
            &info.branch,
            true,
        )
        .unwrap();
        assert!(!info.path.exists());

        // Re-remove is idempotent.
        mgr.remove(
            "agent-12345678",
            &info.path,
            &info.source_repo,
            &info.branch,
            true,
        )
        .unwrap();
    }

    #[test]
    fn dirty_base_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source");
        init_repo(&source);
        std::fs::write(source.join("README.md"), "dirty\n").unwrap();

        let mgr = WorktreeManager::new(dir.path().join("worktrees"));
        let err = mgr
            .create("agent-1", "Scout", &source)
            .expect_err("dirty base must be rejected");
        assert!(matches!(err, WorktreeError::DirtyBase(_)));
        assert_eq!(err.tag(), "dirty_base");
    }

    #[test]
    fn non_repo_directory_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = WorktreeManager::new(dir.path().join("worktrees"));
        let err = mgr
            .create("a", "Scout", dir.path())
            .expect_err("non-repo path must be rejected");
        assert_eq!(err.tag(), "not_a_repo");
    }
}
