import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightIcon } from 'lucide-react';
import type { InterAgentMessage } from '@orbit/types';
import { cn } from '@/lib/cn';
import { useAgentsStore } from '@/stores/agents';
import { ipcAgentGetInterAgentMessages } from '@/lib/ipc';

interface InboxListProps {
  agentId: string;
}

/**
 * Inter-agent message log for the selected agent — both directions.
 * Hydrates from `agent_get_inter_agent_messages` on mount; live
 * updates flow through the `agent:inter_agent_message_dispatched`
 * event which the agents store upserts into
 * `interAgentMessagesByAgent`.
 */
export function InboxList({ agentId }: InboxListProps): JSX.Element {
  const messages = useAgentsStore((s) => s.interAgentMessagesByAgent[agentId] ?? []);
  const setInterAgentMessages = useAgentsStore((s) => s.setInterAgentMessages);
  const agents = useAgentsStore((s) => s.agents);

  useQuery({
    queryKey: ['inter_agent_messages', agentId],
    queryFn: async () => {
      const rows = await ipcAgentGetInterAgentMessages(agentId, 100);
      setInterAgentMessages(agentId, rows);
      return rows;
    },
  });

  const grouped = useMemo(() => {
    const inFlight: InterAgentMessage[] = [];
    const settled: InterAgentMessage[] = [];
    for (const m of messages) {
      if (m.status === 'pending' || m.status === 'delivered') inFlight.push(m);
      else settled.push(m);
    }
    return { inFlight, settled };
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="rounded-card border border-line-2 bg-ink-2 p-3 text-12 text-text-tertiary">
        No agent-to-agent messages yet. Messages routed through the broker show up here.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {grouped.inFlight.length > 0 ? (
        <Section label="In flight">
          {grouped.inFlight.map((m) => (
            <Row key={m.id} message={m} agents={agents} agentId={agentId} />
          ))}
        </Section>
      ) : null}
      <Section label="Recent">
        {grouped.settled.map((m) => (
          <Row key={m.id} message={m} agents={agents} agentId={agentId} />
        ))}
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-11 uppercase tracking-wider text-text-faint">{label}</span>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </div>
  );
}

function Row({
  message,
  agents,
  agentId,
}: {
  message: InterAgentMessage;
  agents: Record<string, { id: string; name: string; emoji: string; color: string }>;
  agentId: string;
}): JSX.Element {
  const from = agents[message.fromAgentId];
  const to = agents[message.toAgentId];
  const isOutbound = message.fromAgentId === agentId;
  return (
    <li className={cn('flex flex-col gap-1.5 rounded-card border border-line-2 bg-ink-2 p-2.5')}>
      <div className="flex items-center gap-1.5 text-11">
        <span aria-hidden className="orbit-emoji">
          {from?.emoji ?? '?'}
        </span>
        <span className="font-mono text-text-secondary">{from?.name ?? 'unknown'}</span>
        <ArrowRightIcon className="h-3 w-3 text-text-faint" aria-hidden />
        <span aria-hidden className="orbit-emoji">
          {to?.emoji ?? '?'}
        </span>
        <span className="font-mono text-text-secondary">{to?.name ?? 'unknown'}</span>
        <span className="ml-auto">
          <StatusPill status={message.status} />
        </span>
      </div>
      <p className="whitespace-pre-wrap text-12 text-text-primary">{message.content}</p>
      <div className="flex items-center gap-2 text-11 text-text-faint">
        <span className="font-mono">{isOutbound ? 'sent' : 'received'}</span>
        <span aria-hidden>·</span>
        <span className="font-mono">depth {message.depth}</span>
        <span aria-hidden className="ml-auto">
          {relativeTime(message.createdAt)}
        </span>
      </div>
    </li>
  );
}

function StatusPill({ status }: { status: string }): JSX.Element {
  const cls = (() => {
    switch (status) {
      case 'pending':
        return 'border-status-waiting/40 bg-status-waiting/10 text-status-waiting';
      case 'delivered':
        return 'border-status-thinking/40 bg-status-thinking/10 text-status-thinking';
      case 'acknowledged':
        return 'border-status-running/40 bg-status-running/10 text-status-running';
      case 'failed':
        return 'border-status-error/40 bg-status-error/10 text-status-error';
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

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(1, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
