import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLinkIcon, GitBranchIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ipcAgentGetBranchInfo, ipcSystemRevealPath } from '@/lib/ipc';

interface BranchSectionProps {
  agentId: string;
  hasWorktree: boolean;
  worktreePath: string | null;
  worktreeBranch: string | null;
}

/**
 * Settings accordion content for git isolation. Shows the worktree
 * path, branch name, source repo, and current commit hash. The
 * "Reveal" button hands off to the OS file explorer via
 * tauri-plugin-opener.
 *
 * For agents without a worktree, surfaces a single line explaining
 * the agent works directly inside its working_dir.
 */
export function BranchSection({
  agentId,
  hasWorktree,
  worktreePath,
}: BranchSectionProps): JSX.Element {
  const branchQuery = useQuery({
    queryKey: ['branch-info', agentId],
    queryFn: () => ipcAgentGetBranchInfo(agentId),
    enabled: hasWorktree,
  });

  const reveal = useMutation({
    mutationFn: (path: string) => ipcSystemRevealPath(path),
  });

  if (!hasWorktree) {
    return (
      <div className="rounded-card border border-line-2 bg-ink-2 p-3 text-12 text-text-tertiary">
        This agent isn&apos;t in a Git worktree — it works directly in its working directory. Spawn
        an agent inside a Git repository to get its own branch.
      </div>
    );
  }

  const branch = branchQuery.data ?? null;
  return (
    <div className="flex flex-col gap-2">
      <Row label="Branch" mono>
        <span className="flex items-center gap-1.5">
          <GitBranchIcon className="h-3 w-3 text-status-running" aria-hidden />
          {branch?.branch ?? '…'}
        </span>
      </Row>
      <Row label="Commit" mono muted>
        {(branch?.currentCommit ?? '').slice(0, 12) || '…'}
      </Row>
      <Row label="Base" mono muted>
        {(branch?.baseRef ?? '').slice(0, 12) || '…'}
      </Row>
      <Row label="Worktree" mono muted>
        {worktreePath ?? '…'}
      </Row>
      <Row label="Source" mono muted>
        {branch?.sourceRepo ?? '…'}
      </Row>
      <button
        type="button"
        onClick={() => {
          if (worktreePath) reveal.mutate(worktreePath);
        }}
        disabled={!worktreePath || reveal.isPending}
        className={cn(
          'mt-1 self-start rounded-button border border-line-2 bg-ink-3 px-3 py-1.5',
          'text-12 text-text-secondary hover:bg-hover hover:text-text-primary',
          'disabled:opacity-50',
        )}
      >
        <ExternalLinkIcon className="mr-1 inline-block h-3 w-3 -translate-y-px" />
        Reveal worktree
      </button>
    </div>
  );
}

function Row({
  label,
  children,
  mono,
  muted,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  muted?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-11 uppercase tracking-wider text-text-tertiary">{label}</span>
      <span
        className={cn(
          'truncate text-13',
          muted ? 'text-text-secondary' : 'text-text-primary',
          mono && 'font-mono text-12',
        )}
      >
        {children}
      </span>
    </div>
  );
}
