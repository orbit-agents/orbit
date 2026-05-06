import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { useAgentsStore } from '@/stores/agents';
import { ipcAgentRename, ipcAgentTerminate, ipcAgentUpdateIdentity } from '@/lib/ipc';
import type { Agent } from '@orbit/types';
import { AccordionSection } from '@/components/accordion';
import { IdentityEditor } from './identity/identity-editor';
import { MemoryList } from './identity/memory-list';
import { AdvancedSection } from './identity/advanced-section';
import { FolderAccess } from './identity/folder-access';
import { InboxList } from './inbox/inbox-list';
import { BranchSection } from './diff/branch-section';

const SOUL_PLACEHOLDER =
  "I'm a senior backend engineer. I write Go, design APIs, and think in terms of data flow and failure modes. I prefer shipping a correct minimal implementation over a feature-rich fragile one. When unsure about a requirement, I ask rather than assume.";

const PURPOSE_PLACEHOLDER =
  "My mission is to maintain the API layer. I own everything in api/ and middleware/. I don't touch the frontend. When I make breaking API changes, I message the frontend agent.";

const IMPORT_ON_SPAWN_KEY = 'orbit:importClaudeMdOnSpawn';

/**
 * Right-panel Settings tab. Phase 3: accordion layout with Profile,
 * About, Soul, Purpose, Memory, and Advanced sections.
 */
export function AgentSettingsPanel(): JSX.Element {
  const agent: Agent | null = useAgentsStore((s) =>
    s.selectedAgentId ? (s.agents[s.selectedAgentId] ?? null) : null,
  );
  const setIdentity = useAgentsStore((s) => s.setIdentity);
  const memoryCount = useAgentsStore((s) =>
    agent ? (s.memoriesByAgent[agent.id]?.length ?? 0) : 0,
  );
  const inboxCount = useAgentsStore((s) =>
    agent ? (s.interAgentMessagesByAgent[agent.id]?.length ?? 0) : 0,
  );

  const updateMutation = useMutation({
    mutationFn: (input: { agentId: string; soul?: string | null; purpose?: string | null }) =>
      ipcAgentUpdateIdentity(input),
  });

  const onSaveSoul = useCallback(
    (next: string) => {
      if (!agent) return;
      setIdentity(agent.id, next, null);
      updateMutation.mutate({ agentId: agent.id, soul: next });
    },
    [agent, setIdentity, updateMutation],
  );

  const onSavePurpose = useCallback(
    (next: string) => {
      if (!agent) return;
      setIdentity(agent.id, null, next);
      updateMutation.mutate({ agentId: agent.id, purpose: next });
    },
    [agent, setIdentity, updateMutation],
  );

  const [importOnSpawn, setImportOnSpawn] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(IMPORT_ON_SPAWN_KEY) === '1';
  });
  const onChangeImportOnSpawn = useCallback((next: boolean) => {
    setImportOnSpawn(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(IMPORT_ON_SPAWN_KEY, next ? '1' : '0');
    }
  }, []);

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center text-13 text-text-tertiary">
        No agent selected.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: `${agent.color}26` }}
        >
          <span className="orbit-emoji text-[22px] leading-none">{agent.emoji}</span>
        </span>
        <div className="flex flex-col">
          <span className="text-14 font-medium text-text-primary">{agent.name}</span>
          <span className="text-11 text-text-tertiary">{agent.workingDir}</span>
        </div>
      </div>

      <AccordionSection title="Profile" defaultOpen summary={agent.name}>
        <RenameRow agentId={agent.id} currentName={agent.name} />
      </AccordionSection>

      <AccordionSection
        title="About"
        summary={`${agent.modelOverride ?? 'default model'} · ${truncate(agent.workingDir, 40)}`}
      >
        <div className="flex flex-col gap-3">
          <InfoRow label="Status" value={agent.status} />
          <InfoRow label="Session" value={agent.sessionId ?? '—'} mono />
          <InfoRow label="Model" value={agent.modelOverride ?? 'default'} mono />
          <InfoRow label="Working dir" value={agent.workingDir} mono />
        </div>
      </AccordionSection>

      <AccordionSection
        title="Soul"
        summary={agent.soul ? truncate(agent.soul, 60) : 'Not set — using defaults'}
      >
        <IdentityEditor
          value={agent.soul ?? ''}
          onSave={onSaveSoul}
          placeholder={SOUL_PLACEHOLDER}
        />
      </AccordionSection>

      <AccordionSection
        title="Purpose"
        summary={agent.purpose ? truncate(agent.purpose, 60) : 'Not set — using defaults'}
      >
        <IdentityEditor
          value={agent.purpose ?? ''}
          onSave={onSavePurpose}
          placeholder={PURPOSE_PLACEHOLDER}
        />
      </AccordionSection>

      <AccordionSection
        title="Memory"
        summary={memoryCount === 0 ? 'No entries' : `${memoryCount} entries`}
      >
        <MemoryList agentId={agent.id} />
      </AccordionSection>

      <AccordionSection
        title="Inbox"
        summary={inboxCount === 0 ? 'No agent traffic' : `${inboxCount} agent messages`}
      >
        <InboxList agentId={agent.id} />
      </AccordionSection>

      <AccordionSection title="Folder access" summary={folderAccessSummary(agent.folderAccess)}>
        <FolderAccess
          agentId={agent.id}
          workingDir={agent.workingDir}
          rawFolderAccess={agent.folderAccess}
        />
      </AccordionSection>

      <AccordionSection
        title="Branch"
        summary={
          agent.hasWorktree ? (agent.worktreeBranch ?? 'git worktree') : 'Not in a Git worktree'
        }
      >
        <BranchSection
          agentId={agent.id}
          hasWorktree={agent.hasWorktree !== 0}
          worktreePath={agent.worktreePath}
          worktreeBranch={agent.worktreeBranch}
        />
      </AccordionSection>

      <AccordionSection title="Advanced" summary="CLAUDE.md import">
        <AdvancedSection
          agentId={agent.id}
          importOnSpawn={importOnSpawn}
          onChangeImportOnSpawn={onChangeImportOnSpawn}
        />
      </AccordionSection>

      <div className="mt-auto px-4 pb-4 pt-6">
        <TerminateButton agentId={agent.id} />
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function folderAccessSummary(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return 'Working dir only';
      return `${parsed.length} extra ${parsed.length === 1 ? 'folder' : 'folders'}`;
    }
  } catch {
    // fall through
  }
  return 'Working dir only';
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-11 uppercase tracking-wider text-text-tertiary">{label}</span>
      <span
        className={cn(
          'truncate text-13 text-text-primary',
          mono && 'font-mono text-12 text-text-secondary',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function RenameRow({
  agentId,
  currentName,
}: {
  agentId: string;
  currentName: string;
}): JSX.Element {
  const [draft, setDraft] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const renameAgent = useAgentsStore((s) => s.renameAgent);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (name: string) => ipcAgentRename(agentId, name),
    onSuccess: (_r, name) => {
      renameAgent(agentId, name.trim());
      void qc.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (e) => setError(String(e)),
  });

  const dirty = draft.trim() !== currentName;
  const disabled = !dirty || mutation.isPending || draft.trim().length === 0;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-11 uppercase tracking-wider text-text-tertiary">Name</span>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          className={cn(
            'flex-1 rounded-input border border-border bg-elevated px-3 py-2',
            'text-13 text-text-primary focus:border-accent focus:outline-none',
          )}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => mutation.mutate(draft)}
          className={cn(
            'rounded-button bg-accent px-3 py-2 text-13 font-medium text-white',
            'disabled:opacity-40',
          )}
        >
          Save
        </button>
      </div>
      {error ? <span className="text-11 text-status-error">{error}</span> : null}
    </div>
  );
}

function TerminateButton({ agentId }: { agentId: string }): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation({
    mutationFn: () => ipcAgentTerminate(agentId),
  });
  return (
    <div className="pt-2">
      {confirming ? (
        <div className="flex items-center justify-between rounded-panel border border-status-error/40 bg-status-error/10 p-3">
          <span className="text-13 text-status-error">Terminate this agent?</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-button px-3 py-1.5 text-13 text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => {
                mutation.mutate();
                setConfirming(false);
              }}
              className="rounded-button bg-status-error px-3 py-1.5 text-13 font-medium text-white hover:opacity-90"
            >
              Terminate
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={cn(
            'w-full rounded-button border border-status-error/40 px-3 py-2',
            'text-13 text-status-error hover:bg-status-error/10',
          )}
        >
          Terminate agent
        </button>
      )}
    </div>
  );
}

export const IMPORT_ON_SPAWN_STORAGE_KEY = IMPORT_ON_SPAWN_KEY;
