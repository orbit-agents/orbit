import { useMemo, useState } from 'react';
import { PlusIcon, SearchIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAgentsStore, deriveStatus, type DerivedStatus } from '@/stores/agents';
import { useUiStore } from '@/stores/ui-store';
import type { Agent, Message } from '@orbit/types';

interface Props {
  onSpawnClick: () => void;
}

function statusDotColor(status: DerivedStatus): string {
  switch (status) {
    case 'active':
      return 'bg-status-active';
    case 'waiting_for_human':
      return 'bg-status-waiting';
    case 'error':
      return 'bg-status-error';
    case 'idle':
    default:
      return 'bg-text-tertiary';
  }
}

function lastAssistantText(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'assistant') continue;
    try {
      const parsed = JSON.parse(m.content) as { text?: unknown };
      if (typeof parsed.text === 'string') return parsed.text;
    } catch {
      return null;
    }
  }
  return null;
}

function AgentRow({
  agent,
  status,
  subtitle,
  selected,
  onClick,
}: {
  agent: Agent;
  status: DerivedStatus;
  subtitle: string;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex w-full items-start gap-2 rounded-input px-2 py-2 text-left',
        selected ? 'bg-hover' : 'hover:bg-hover/60',
      )}
    >
      <div className="relative shrink-0">
        <span
          aria-hidden
          className="flex h-8 w-8 items-center justify-center rounded-full"
          style={{ backgroundColor: `${agent.color}26` }}
        >
          <span className="orbit-emoji text-16 leading-none">{agent.emoji}</span>
        </span>
        <span
          aria-hidden
          className={cn(
            'absolute -right-0.5 -bottom-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-panel',
            statusDotColor(status),
          )}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            'truncate text-13 font-medium',
            selected ? 'text-text-primary' : 'text-text-secondary',
          )}
        >
          {agent.name}
        </span>
        {subtitle ? <span className="truncate text-11 text-text-tertiary">{subtitle}</span> : null}
      </div>
    </button>
  );
}

export function AgentList({ onSpawnClick }: Props): JSX.Element {
  const [query, setQuery] = useState('');

  // Subscribe to the raw slices (stable references) and derive the array in
  // useMemo. The previous form `(s) => s.orderedAgentIds.map(...).filter(...)`
  // returned a new array reference on every selector call — Zustand's default
  // Object.is equality treated each call as a state change, which combined
  // with React Flow's <StoreUpdater> below caused an infinite re-render loop.
  const orderedAgentIds = useAgentsStore((s) => s.orderedAgentIds);
  const agentsById = useAgentsStore((s) => s.agents);
  const agents = useMemo(
    () => orderedAgentIds.map((id) => agentsById[id]).filter(Boolean) as Agent[],
    [orderedAgentIds, agentsById],
  );

  const selectedAgentId = useAgentsStore((s) => s.selectedAgentId);
  const messagesByAgent = useAgentsStore((s) => s.messagesByAgent);
  const streamingByAgent = useAgentsStore((s) => s.streamingByAgent);
  const lastErrorByAgent = useAgentsStore((s) => s.lastErrorByAgent);
  const selectAgent = useAgentsStore((s) => s.selectAgent);
  const openRightPanelTab = useUiStore((s) => s.openRightPanelTab);

  const rows = useMemo(() => {
    return agents.map((a) => {
      const streaming = streamingByAgent[a.id] ?? null;
      const err = lastErrorByAgent[a.id] ?? null;
      const lastText = lastAssistantText(messagesByAgent[a.id] ?? []);
      const status = deriveStatus(a, streaming, err, lastText);
      const subtitle = streaming
        ? (streaming.text.split('\n').at(-1) ?? '').slice(0, 80)
        : err
          ? `error: ${err.slice(0, 60)}`
          : (lastText ?? '').slice(0, 80);
      return { agent: a, status, subtitle };
    });
  }, [agents, streamingByAgent, lastErrorByAgent, messagesByAgent]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      ({ agent, subtitle }) =>
        agent.name.toLowerCase().includes(q) || subtitle.toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <section className="flex flex-col gap-2 px-2 py-2">
      <div className="flex items-center justify-between px-1 text-11 font-medium uppercase tracking-wider text-text-tertiary">
        <span>Agents ({agents.length})</span>
        <button
          type="button"
          onClick={onSpawnClick}
          className="rounded-input p-1 text-text-tertiary hover:bg-hover hover:text-text-primary"
          aria-label="Spawn agent"
          title="Spawn agent (Cmd/Ctrl+Shift+N)"
        >
          <PlusIcon className="h-3 w-3" />
        </button>
      </div>

      {agents.length > 0 ? (
        <div className="flex items-center gap-2 rounded-input border border-border-subtle bg-elevated px-2 py-1">
          <SearchIcon className="h-3 w-3 text-text-tertiary" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter agents…"
            className={cn(
              'w-full bg-transparent text-12 text-text-primary placeholder:text-text-tertiary',
              'focus:outline-none',
            )}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        {filtered.length === 0 && agents.length > 0 ? (
          <span className="px-2 py-2 text-12 italic text-text-tertiary">No matches</span>
        ) : agents.length === 0 ? (
          <span className="px-2 py-2 text-12 italic text-text-tertiary">No agents yet</span>
        ) : (
          filtered.map(({ agent, status, subtitle }) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              status={status}
              subtitle={subtitle}
              selected={agent.id === selectedAgentId}
              onClick={() => {
                selectAgent(agent.id);
                openRightPanelTab('chat');
              }}
            />
          ))
        )}
      </div>
    </section>
  );
}
