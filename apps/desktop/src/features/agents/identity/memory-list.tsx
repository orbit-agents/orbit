import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BotIcon, FileTextIcon, PencilIcon, SearchIcon, TrashIcon } from 'lucide-react';
import type { MemoryEntry } from '@orbit/types';
import { cn } from '@/lib/cn';
import { useAgentsStore } from '@/stores/agents';
import { ipcMemoryCreate, ipcMemoryDelete, ipcMemoryList, ipcMemoryUpdate } from '@/lib/ipc';

interface MemoryListProps {
  agentId: string;
}

/**
 * Per-agent memory editor. Loads the entries via `memory_list`, supports
 * search, inline edit, delete, and a footer add form.
 *
 * Live updates from the backend (the `agent:memory_added` event) flow
 * through the agents store, so this component reads from the store
 * rather than re-fetching on every event.
 */
export function MemoryList({ agentId }: MemoryListProps): JSX.Element {
  const memoriesFromStore = useAgentsStore((s) => s.memoriesByAgent[agentId] ?? []);
  const setMemories = useAgentsStore((s) => s.setMemories);
  const [search, setSearch] = useState('');

  // Hydrate the store from the backend on first mount or when the
  // selected agent changes. We don't paginate — Phase 3 caps the list
  // to whatever a single SELECT returns.
  useQuery({
    queryKey: ['memory_list', agentId],
    queryFn: async () => {
      const entries = await ipcMemoryList(agentId);
      setMemories(agentId, entries);
      return entries;
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return memoriesFromStore;
    return memoriesFromStore.filter((e) => e.content.toLowerCase().includes(q));
  }, [memoriesFromStore, search]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memory…"
          className={cn(
            'w-full rounded-input border border-border bg-elevated pl-8 pr-3 py-2',
            'text-13 text-text-primary placeholder:text-text-tertiary',
            'focus:border-accent focus:outline-none',
          )}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState search={search.trim()} />
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((entry) => (
            <MemoryRow key={entry.id} entry={entry} agentId={agentId} />
          ))}
        </ul>
      )}

      <AddMemoryForm agentId={agentId} />
    </div>
  );
}

function EmptyState({ search }: { search: string }): JSX.Element {
  if (search) {
    return (
      <div className="rounded-card border border-border-subtle bg-elevated p-3 text-12 text-text-tertiary">
        No memory matches “{search}”.
      </div>
    );
  }
  return (
    <div className="rounded-card border border-border-subtle bg-elevated p-3 text-12 text-text-tertiary">
      No memory yet. Things you teach this agent or that it learns from your conversations will
      appear here.
    </div>
  );
}

function MemoryRow({ entry, agentId }: { entry: MemoryEntry; agentId: string }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);
  const updateMemory = useAgentsStore((s) => s.updateMemory);
  const deleteMemoryStore = useAgentsStore((s) => s.deleteMemory);
  const highlighted = useAgentsStore((s) => Boolean(s.recentlyAddedMemoryIds[entry.id]));
  const clearHighlight = useAgentsStore((s) => s.clearMemoryHighlight);

  // Auto-clear the highlight after the animation completes (2s) so the
  // memory entry settles into its resting style.
  useEffect(() => {
    if (!highlighted) return;
    const t = window.setTimeout(() => clearHighlight(entry.id), 2000);
    return () => window.clearTimeout(t);
  }, [highlighted, clearHighlight, entry.id]);

  const updateMutation = useMutation({
    mutationFn: async (content: string) => ipcMemoryUpdate(entry.id, content),
    onSuccess: (next) => {
      updateMemory(agentId, next);
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => ipcMemoryDelete(entry.id, agentId),
    onSuccess: () => deleteMemoryStore(agentId, entry.id),
  });

  return (
    <li
      className={cn(
        'group flex items-start gap-2 rounded-card border border-border-subtle bg-panel p-3',
        'transition-colors duration-base',
        highlighted && 'border-accent/40 bg-accent/5',
      )}
    >
      <SourceIcon source={entry.source} />
      <div className="flex flex-1 flex-col gap-1">
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className={cn(
              'w-full resize-y rounded-input border border-border bg-elevated px-2 py-1.5',
              'font-mono text-12 text-text-primary',
              'focus:border-accent focus:outline-none',
            )}
          />
        ) : (
          <p className="whitespace-pre-wrap text-13 text-text-primary">{entry.content}</p>
        )}
        <footer className="flex items-center gap-2 text-11 text-text-tertiary">
          <span>{relativeTime(entry.createdAt)}</span>
          {entry.category ? (
            <span className="rounded-input bg-hover px-1.5 py-0.5 text-text-secondary">
              {entry.category}
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity duration-fast group-hover:opacity-100">
            {editing ? (
              <>
                <button
                  type="button"
                  className="rounded-button px-2 py-0.5 hover:bg-hover hover:text-text-primary"
                  onClick={() => {
                    setDraft(entry.content);
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={updateMutation.isPending || draft.trim().length === 0}
                  className="rounded-button bg-accent px-2 py-0.5 text-white disabled:opacity-50"
                  onClick={() => updateMutation.mutate(draft)}
                >
                  Save
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  aria-label="Edit memory"
                  className="rounded-button p-1 hover:bg-hover hover:text-text-primary"
                  onClick={() => {
                    setDraft(entry.content);
                    setEditing(true);
                  }}
                >
                  <PencilIcon className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label="Delete memory"
                  className="rounded-button p-1 hover:bg-status-error/15 hover:text-status-error"
                  onClick={() => deleteMutation.mutate()}
                >
                  <TrashIcon className="h-3 w-3" />
                </button>
              </>
            )}
          </span>
        </footer>
      </div>
    </li>
  );
}

function SourceIcon({ source }: { source: string }): JSX.Element {
  if (source === 'agent') {
    return (
      <span
        title="Saved by the agent via the remember tool"
        className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent/15 text-accent"
      >
        <BotIcon className="h-3 w-3" aria-hidden />
        <span className="sr-only">Saved by agent</span>
      </span>
    );
  }
  if (source === 'imported') {
    return (
      <span
        title="Imported from CLAUDE.md"
        className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-text-tertiary"
      >
        <FileTextIcon className="h-3 w-3" aria-hidden />
        <span className="sr-only">Imported</span>
      </span>
    );
  }
  return (
    <span
      title="Written by you"
      className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-text-secondary"
    >
      <PencilIcon className="h-3 w-3" aria-hidden />
      <span className="sr-only">Written by you</span>
    </span>
  );
}

function AddMemoryForm({ agentId }: { agentId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const addMemory = useAgentsStore((s) => s.addMemory);
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => ipcMemoryCreate({ agentId, content: content.trim() }),
    onSuccess: (entry) => {
      addMemory(agentId, entry, { highlight: true });
      setContent('');
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['memory_list', agentId] });
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'self-start rounded-button border border-border-subtle bg-elevated px-3 py-1.5',
          'text-12 text-text-secondary hover:bg-hover hover:text-text-primary',
        )}
      >
        + Add memory
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-elevated p-3">
      <textarea
        autoFocus
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Something this agent should remember…"
        rows={3}
        className={cn(
          'w-full resize-y rounded-input border border-border bg-panel px-2 py-1.5',
          'font-mono text-12 text-text-primary placeholder:text-text-tertiary',
          'focus:border-accent focus:outline-none',
        )}
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="rounded-button px-2 py-1 text-12 text-text-secondary hover:text-text-primary"
          onClick={() => {
            setContent('');
            setOpen(false);
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={mutation.isPending || content.trim().length === 0}
          onClick={() => mutation.mutate()}
          className="rounded-button bg-accent px-3 py-1 text-12 font-medium text-white disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const now = Date.now();
  const seconds = Math.max(1, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}
