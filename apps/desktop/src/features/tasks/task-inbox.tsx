import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightIcon, BotIcon, ListChecksIcon } from 'lucide-react';
import type { ActivityEntry, Task } from '@orbit/types';
import { cn } from '@/lib/cn';
import { useAgentsStore } from '@/stores/agents';
import { useUiStore } from '@/stores/ui-store';
import { ipcAgentGetActivityFeed, ipcTaskListAll } from '@/lib/ipc';

const LANES: Array<{ key: string; label: string }> = [
  { key: 'awaiting_human', label: 'Awaiting you' },
  { key: 'running', label: 'Running' },
  { key: 'queued', label: 'Queued' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
];

/**
 * V1 Ledger Task Inbox. Replaces the canvas in the center pane when
 * the user clicks the sidebar Tasks row. Lanes by status across
 * every agent + an activity feed at the top.
 */
export function TaskInbox(): JSX.Element {
  const tasksQuery = useQuery({
    queryKey: ['tasks-all'],
    queryFn: () => ipcTaskListAll(500),
    refetchInterval: 6000,
  });
  const feedQuery = useQuery({
    queryKey: ['activity-feed'],
    queryFn: () => ipcAgentGetActivityFeed(50),
    refetchInterval: 6000,
  });

  const tasks = tasksQuery.data ?? [];
  const feed = feedQuery.data ?? [];

  return (
    <div className="flex h-full flex-col bg-app">
      <header className="flex items-center gap-2 border-b border-line-0 px-4 py-2.5">
        <ListChecksIcon className="h-3.5 w-3.5 text-text-faint" aria-hidden />
        <span className="text-13 font-medium text-text-primary">Task inbox</span>
        <span className="ml-2 font-mono text-11 text-text-faint">{tasks.length} total</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex flex-1 gap-2 overflow-x-auto p-3">
          {LANES.map((lane) => {
            const lane_tasks = tasks.filter((t) => t.status === lane.key);
            return (
              <Lane key={lane.key} label={lane.label} count={lane_tasks.length}>
                {lane_tasks.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </Lane>
            );
          })}
        </main>
        <ActivityFeed feed={feed} />
      </div>
    </div>
  );
}

function Lane({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex w-[280px] flex-shrink-0 flex-col gap-2">
      <div className="flex items-center justify-between rounded-card border border-line-2 bg-ink-1 px-3 py-2">
        <span className="font-mono text-10 uppercase tracking-[0.12em] text-text-secondary">
          {label}
        </span>
        <span className="font-mono text-10 text-text-faint">{count}</span>
      </div>
      <ul className="flex flex-col gap-1.5 overflow-y-auto pr-1">{children}</ul>
    </div>
  );
}

function TaskCard({ task }: { task: Task }): JSX.Element {
  const agent = useAgentsStore((s) => s.agents[task.agentId]);
  const selectAgent = useAgentsStore((s) => s.selectAgent);
  const setCenterView = useUiStore((s) => s.setCenterView);
  const setRightPanelTab = useUiStore((s) => s.setRightPanelTab);

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          selectAgent(task.agentId);
          setRightPanelTab('settings');
          setCenterView('canvas');
        }}
        className={cn(
          'group flex w-full flex-col gap-1.5 rounded-card border border-line-2 bg-ink-2 p-2.5 text-left',
          'hover:border-line-3 hover:bg-hover/50',
        )}
      >
        <span className="text-12 text-text-primary">{task.title}</span>
        {task.description ? (
          <span className="line-clamp-2 text-11 text-text-tertiary">{task.description}</span>
        ) : null}
        <span className="mt-0.5 flex items-center gap-1.5 text-10 text-text-faint">
          {agent ? (
            <>
              <span aria-hidden className="orbit-emoji">
                {agent.emoji}
              </span>
              <span className="font-mono">{agent.name}</span>
            </>
          ) : (
            <span className="font-mono">unknown agent</span>
          )}
          <span aria-hidden>·</span>
          <span className="font-mono">{task.priority}</span>
        </span>
      </button>
    </li>
  );
}

function ActivityFeed({ feed }: { feed: ActivityEntry[] }): JSX.Element {
  const grouped = useMemo(() => groupByDay(feed), [feed]);
  return (
    <aside className="flex w-[320px] flex-shrink-0 flex-col border-l border-line-0 bg-ink-1">
      <header className="flex items-center gap-2 border-b border-line-0 px-3 py-2">
        <ArrowRightIcon className="h-3 w-3 text-text-faint" aria-hidden />
        <span className="font-mono text-10 uppercase tracking-[0.12em] text-text-faint">
          Activity
        </span>
      </header>
      <div className="flex-1 overflow-y-auto p-3">
        {feed.length === 0 ? (
          <div className="rounded-card border border-line-2 bg-ink-2 p-3 text-11 text-text-tertiary">
            No activity yet. Task transitions and agent-saved memory show up here.
          </div>
        ) : (
          grouped.map(([day, entries]) => (
            <div key={day} className="mb-4 last:mb-0">
              <h3 className="mb-1.5 font-mono text-10 uppercase tracking-[0.12em] text-text-faint">
                {day}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {entries.map((e, i) => (
                  <ActivityRow key={`${e.kind}-${e.taskId ?? e.memoryId ?? i}`} entry={e} />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }): JSX.Element {
  const agent = useAgentsStore((s) => s.agents[entry.agentId]);
  return (
    <li className="rounded-card border border-line-2 bg-ink-2 p-2 text-11">
      <div className="flex items-center gap-1.5 text-10 text-text-faint">
        {agent ? (
          <>
            <span aria-hidden className="orbit-emoji">
              {agent.emoji}
            </span>
            <span className="font-mono text-text-secondary">{agent.name}</span>
          </>
        ) : (
          <span className="font-mono">agent</span>
        )}
        <span aria-hidden>·</span>
        {entry.kind === 'memory' ? (
          <span className="flex items-center gap-1 font-mono">
            <BotIcon className="h-2.5 w-2.5" />
            remembered
          </span>
        ) : (
          <span className="font-mono">{entry.status ?? '—'}</span>
        )}
        <span aria-hidden className="ml-auto">
          {timeOnly(entry.timestamp)}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-text-primary">{entry.title}</p>
    </li>
  );
}

function groupByDay(entries: readonly ActivityEntry[]): Array<[string, ActivityEntry[]]> {
  const groups = new Map<string, ActivityEntry[]>();
  for (const e of entries) {
    const day = dayLabel(e.timestamp);
    const list = groups.get(day) ?? [];
    list.push(e);
    groups.set(day, list);
  }
  return [...groups.entries()];
}

function dayLabel(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const today = new Date();
  const diffDays = Math.round((today.getTime() - t.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return t.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeOnly(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
