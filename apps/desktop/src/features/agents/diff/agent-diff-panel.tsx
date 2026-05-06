import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDownIcon, ChevronRightIcon, GitBranchIcon, RotateCwIcon } from 'lucide-react';
import type { Agent, BranchInfo, FileDiff } from '@orbit/types';
import { cn } from '@/lib/cn';
import { useAgentsStore } from '@/stores/agents';
import { ipcAgentGetBranchInfo, ipcAgentGetDiff } from '@/lib/ipc';

/**
 * V1 Ledger Diff tab — runs `git diff <base>...HEAD` (with
 * uncommitted + untracked changes folded in) on the agent's
 * worktree and renders per-file collapsible blocks.
 *
 * For non-worktree agents (the Phase 1 "agent works directly in
 * working_dir" path), shows a friendly empty state explaining that
 * isolation is opt-in by spawning inside a Git repo.
 */
export function AgentDiffPanel(): JSX.Element {
  const agent: Agent | null = useAgentsStore((s) =>
    s.selectedAgentId ? (s.agents[s.selectedAgentId] ?? null) : null,
  );

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center text-13 text-text-tertiary">
        No agent selected.
      </div>
    );
  }

  if (agent.hasWorktree === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <GitBranchIcon className="h-5 w-5 text-text-faint" aria-hidden />
        <p className="text-13 text-text-secondary">No git isolation for this agent.</p>
        <p className="max-w-[320px] text-11 text-text-tertiary">
          Spawn an agent inside a Git repository to give it its own branch and worktree. This agent
          works directly in <span className="font-mono">{agent.workingDir}</span>.
        </p>
      </div>
    );
  }

  return <DiffBody agent={agent} />;
}

function DiffBody({ agent }: { agent: Agent }): JSX.Element {
  const branchQuery = useQuery({
    queryKey: ['branch-info', agent.id],
    queryFn: () => ipcAgentGetBranchInfo(agent.id),
  });
  const diffQuery = useQuery({
    queryKey: ['diff', agent.id],
    queryFn: () => ipcAgentGetDiff(agent.id),
    refetchInterval: 4000,
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line-0 px-4 py-2.5">
        <GitBranchIcon className="h-3.5 w-3.5 text-status-running" aria-hidden />
        <span className="font-mono text-12 text-text-primary">
          {branchQuery.data?.branch ?? agent.worktreeBranch ?? '…'}
        </span>
        <span className="font-mono text-10 text-text-faint">
          {(branchQuery.data?.currentCommit ?? '').slice(0, 7)}
        </span>
        <button
          type="button"
          onClick={() => {
            void diffQuery.refetch();
            void branchQuery.refetch();
          }}
          aria-label="Refresh diff"
          className={cn(
            'ml-auto rounded-[3px] p-1 text-text-faint hover:bg-hover hover:text-text-secondary',
          )}
        >
          <RotateCwIcon className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        <DiffStats branch={branchQuery.data ?? null} files={diffQuery.data ?? []} />
        {diffQuery.isLoading ? (
          <div className="mt-3 px-2 text-11 text-text-faint">Computing diff…</div>
        ) : (diffQuery.data ?? []).length === 0 ? (
          <EmptyDiff />
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {(diffQuery.data ?? []).map((file) => (
              <FileBlock key={file.path} file={file} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DiffStats({
  branch,
  files,
}: {
  branch: BranchInfo | null;
  files: FileDiff[];
}): JSX.Element {
  const totalAdds = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDels = files.reduce((sum, f) => sum + f.deletions, 0);
  return (
    <div className="rounded-card border border-line-2 bg-ink-2 p-3 font-mono text-11 text-text-tertiary">
      <div className="flex items-center justify-between">
        <span>{files.length} files changed</span>
        <span>
          <span className="text-status-running">+{totalAdds}</span>
          <span aria-hidden className="mx-1 text-text-faint">
            ·
          </span>
          <span className="text-status-failed">−{totalDels}</span>
        </span>
      </div>
      {branch ? (
        <div className="mt-1.5 truncate text-text-faint">
          base {branch.baseRef.slice(0, 7)} · {branch.sourceRepo}
        </div>
      ) : null}
    </div>
  );
}

function EmptyDiff(): JSX.Element {
  return (
    <div className="mt-3 rounded-card border border-line-2 bg-ink-2 p-6 text-center">
      <p className="text-13 text-text-secondary">No changes yet.</p>
      <p className="mt-1 text-11 text-text-tertiary">
        Edits the agent makes inside its worktree will show up here.
      </p>
    </div>
  );
}

function FileBlock({ file }: { file: FileDiff }): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <li className="rounded-card border border-line-2 bg-ink-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-card px-3 py-2 text-left hover:bg-hover/50"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDownIcon className="h-3 w-3 text-text-faint" />
        ) : (
          <ChevronRightIcon className="h-3 w-3 text-text-faint" />
        )}
        <span className="font-mono text-12 text-text-primary">{file.path}</span>
        <span className="ml-auto flex items-center gap-2 font-mono text-11">
          <FileBadge status={file.status} />
          <span className="text-status-running">+{file.additions}</span>
          <span className="text-status-failed">−{file.deletions}</span>
        </span>
      </button>
      {open ? (
        <div className="border-t border-line-1 p-2">
          {file.hunks.length === 0 ? (
            <div className="px-2 py-1 font-mono text-11 text-text-faint">(binary or empty)</div>
          ) : (
            file.hunks.map((hunk, idx) => (
              <div key={idx} className="mt-2 first:mt-0">
                <div className="rounded-[3px] bg-ink-3 px-2 py-0.5 font-mono text-10 text-text-tertiary">
                  {hunk.header.replace(/\n$/, '')}
                </div>
                <pre className="mt-1 overflow-x-auto rounded-[3px] bg-ink-3 p-2 font-mono text-11 leading-relaxed">
                  {hunk.lines.map((line, lineIdx) => (
                    <DiffLineView key={lineIdx} line={line} />
                  ))}
                </pre>
              </div>
            ))
          )}
        </div>
      ) : null}
    </li>
  );
}

function FileBadge({ status }: { status: string }): JSX.Element {
  const cls = (() => {
    switch (status) {
      case 'added':
      case 'untracked':
        return 'border-status-running/40 bg-status-running/10 text-status-running';
      case 'deleted':
        return 'border-status-failed/40 bg-status-failed/10 text-status-failed';
      case 'renamed':
        return 'border-status-thinking/40 bg-status-thinking/10 text-status-thinking';
      default:
        return 'border-line-2 bg-ink-3 text-text-tertiary';
    }
  })();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[3px] border px-1.5 py-0.5 font-mono text-10',
        cls,
      )}
    >
      {status}
    </span>
  );
}

function DiffLineView({ line }: { line: { origin: string; content: string } }): JSX.Element {
  const cls =
    line.origin === '+'
      ? 'bg-status-running/10 text-status-running'
      : line.origin === '-'
        ? 'bg-status-failed/10 text-status-failed'
        : 'text-text-secondary';
  return (
    <span className={cn('block whitespace-pre', cls)}>
      {line.origin}
      {line.content.replace(/\n$/, '')}
    </span>
  );
}
