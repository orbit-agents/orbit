import { PlusIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAgentsStore } from '@/stores/agents';
import type { Agent } from '@orbit/types';

interface Props {
  onSpawnClick: () => void;
}

function StatusDot({ status }: { status: string }): JSX.Element {
  const color =
    status === 'active'
      ? 'bg-status-active'
      : status === 'error'
        ? 'bg-status-error'
        : status === 'waiting_for_human'
          ? 'bg-status-waiting'
          : 'bg-text-tertiary';
  return <span aria-hidden className={cn('h-2 w-2 rounded-full', color)} />;
}

function AgentRow({
  agent,
  selected,
  onClick,
}: {
  agent: Agent;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-input px-2 py-2 text-left text-13',
        selected ? 'bg-hover text-text-primary' : 'text-text-secondary hover:bg-hover/60',
      )}
      aria-current={selected ? 'true' : undefined}
    >
      <span aria-hidden className="text-14">
        {agent.emoji}
      </span>
      <span className="flex-1 truncate">{agent.name}</span>
      <StatusDot status={agent.status} />
    </button>
  );
}

export function AgentList({ onSpawnClick }: Props): JSX.Element {
  const agents = useAgentsStore(
    (s) => s.orderedAgentIds.map((id) => s.agents[id]).filter(Boolean) as Agent[],
  );
  const activeAgentId = useAgentsStore((s) => s.activeAgentId);
  const selectAgent = useAgentsStore((s) => s.selectAgent);

  return (
    <section className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center justify-between text-11 font-medium uppercase tracking-wider text-text-tertiary">
        <span>Agents</span>
        <button
          type="button"
          onClick={onSpawnClick}
          className="rounded-input p-1 text-text-tertiary hover:bg-hover hover:text-text-primary"
          aria-label="Spawn agent"
          title="Spawn agent"
        >
          <PlusIcon className="h-3 w-3" />
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {agents.length === 0 ? (
          <span className="px-2 py-2 text-13 italic text-text-tertiary">No agents yet</span>
        ) : (
          agents.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              selected={a.id === activeAgentId}
              onClick={() => selectAgent(a.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}
