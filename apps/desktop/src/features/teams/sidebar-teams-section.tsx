import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon, TrashIcon, PencilIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAgentsStore } from '@/stores/agents';
import { ipcTeamCreate, ipcTeamDelete, ipcTeamUpdate } from '@/lib/ipc';

/**
 * Sidebar "Teams" section — V1 Ledger styling. Each row shows a small
 * color swatch, the team name, and a mono-faint member count.
 * Clicking a row sets `focusedTeamId` on the agents store; the canvas
 * watches for that and pans to fit the team's members.
 */
const TEAM_COLOR_PALETTE: readonly string[] = [
  '#3a4a3e', // muted green
  '#3a3e4a', // muted slate
  '#4a4030', // muted amber
  '#3a4548', // muted teal
  '#48383f', // muted plum
  '#454a3a', // muted olive
];

export function SidebarTeamsSection(): JSX.Element {
  const orderedTeamIds = useAgentsStore((s) => s.orderedTeamIds);
  const teams = useAgentsStore((s) => s.teams);
  const agents = useAgentsStore((s) => s.agents);
  const focusTeam = useAgentsStore((s) => s.focusTeam);
  const upsertTeam = useAgentsStore((s) => s.upsertTeam);
  const qc = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');

  const memberCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const id of Object.keys(agents)) {
      const a = agents[id]!;
      if (a.teamId) counts[a.teamId] = (counts[a.teamId] ?? 0) + 1;
    }
    return counts;
  }, [agents]);

  const create = useMutation({
    mutationFn: (name: string) => {
      const color =
        TEAM_COLOR_PALETTE[orderedTeamIds.length % TEAM_COLOR_PALETTE.length] ??
        TEAM_COLOR_PALETTE[0]!;
      return ipcTeamCreate({ name, color });
    },
    onSuccess: (team) => {
      upsertTeam(team);
      void qc.invalidateQueries({ queryKey: ['teams'] });
      setDraftName('');
      setCreating(false);
    },
  });

  return (
    <section className="flex flex-col gap-1 px-2 pt-2">
      <header className="flex items-center justify-between px-2 pt-1">
        <span className="font-mono text-10 uppercase tracking-[0.12em] text-text-faint">Teams</span>
        <button
          type="button"
          aria-label="Create team"
          className="rounded-[3px] p-1 text-text-faint hover:bg-hover hover:text-text-secondary"
          onClick={() => setCreating(true)}
        >
          <PlusIcon className="h-3 w-3" />
        </button>
      </header>

      {creating ? (
        <div className="flex items-center gap-1 px-2 pb-1">
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draftName.trim().length > 0) {
                create.mutate(draftName.trim());
              } else if (e.key === 'Escape') {
                setDraftName('');
                setCreating(false);
              }
            }}
            placeholder="team name"
            className={cn(
              'flex-1 rounded-[3px] border border-line-2 bg-ink-3 px-2 py-1 text-12 text-text-primary',
              'placeholder:text-text-faint focus:border-line-3 focus:outline-none',
            )}
          />
        </div>
      ) : null}

      <ul className="flex flex-col">
        {orderedTeamIds.length === 0 && !creating ? (
          <li className="px-2 py-1 text-11 text-text-faint">
            No teams yet. Group agents to coordinate work.
          </li>
        ) : null}
        {orderedTeamIds.map((id) => {
          const team = teams[id];
          if (!team) return null;
          const count = memberCounts[id] ?? 0;
          return (
            <TeamRow
              key={id}
              id={id}
              name={team.name}
              color={team.color}
              count={count}
              onClick={() => focusTeam(id)}
            />
          );
        })}
      </ul>
    </section>
  );
}

function TeamRow({
  id,
  name,
  color,
  count,
  onClick,
}: {
  id: string;
  name: string;
  color: string;
  count: number;
  onClick: () => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const upsertTeam = useAgentsStore((s) => s.upsertTeam);
  const removeTeam = useAgentsStore((s) => s.removeTeam);
  const teams = useAgentsStore((s) => s.teams);
  const qc = useQueryClient();

  const rename = useMutation({
    mutationFn: (newName: string) => ipcTeamUpdate({ teamId: id, name: newName, color: null }),
    onSuccess: (_r, newName) => {
      const current = teams[id];
      if (current) upsertTeam({ ...current, name: newName });
      void qc.invalidateQueries({ queryKey: ['teams'] });
      setEditing(false);
    },
  });

  const remove = useMutation({
    mutationFn: () => ipcTeamDelete(id),
    onSuccess: () => {
      removeTeam(id);
      void qc.invalidateQueries({ queryKey: ['teams'] });
      void qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  if (editing) {
    return (
      <li>
        <div className="flex items-center gap-1 px-2 py-1">
          <span
            aria-hidden
            className="h-2.5 w-2.5 flex-shrink-0 rounded-[2px]"
            style={{ background: color }}
          />
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim().length > 0) {
                rename.mutate(draft.trim());
              } else if (e.key === 'Escape') {
                setDraft(name);
                setEditing(false);
              }
            }}
            onBlur={() => {
              if (draft.trim() === name || draft.trim().length === 0) {
                setDraft(name);
                setEditing(false);
              }
            }}
            className={cn(
              'flex-1 rounded-[3px] border border-line-2 bg-ink-3 px-2 py-0.5 text-12 text-text-primary',
              'focus:border-line-3 focus:outline-none',
            )}
          />
        </div>
      </li>
    );
  }

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-2 rounded-[3px] px-2 py-1',
          'transition-colors duration-fast hover:bg-hover',
        )}
      >
        <button
          type="button"
          onClick={onClick}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <span
            aria-hidden
            className="h-2.5 w-2.5 flex-shrink-0 rounded-[2px]"
            style={{ background: color }}
          />
          <span className="flex-1 truncate text-12 text-text-secondary">{name}</span>
          <span className="font-mono text-10 text-text-faint">{count}</span>
        </button>
        <span className="ml-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-fast group-hover:opacity-100">
          <button
            type="button"
            aria-label={`Rename team ${name}`}
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            className="rounded-[3px] p-1 text-text-faint hover:bg-hover hover:text-text-secondary"
          >
            <PencilIcon className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label={`Delete team ${name}`}
            onClick={(e) => {
              e.stopPropagation();
              if (
                window.confirm(`Delete team "${name}"? Members will be unassigned but agents stay.`)
              ) {
                remove.mutate();
              }
            }}
            className="rounded-[3px] p-1 text-text-faint hover:bg-hover hover:text-status-error"
          >
            <TrashIcon className="h-3 w-3" />
          </button>
        </span>
      </div>
    </li>
  );
}
