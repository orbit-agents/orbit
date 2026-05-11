import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from 'lucide-react';
import type { Task } from '@orbit/types';
import { cn } from '@/lib/cn';
import { useAgentsStore } from '@/stores/agents';
import { EMPTY_ARRAY } from '@/lib/stable-empty';
import { ipcTaskCreate, ipcTaskDelete, ipcTaskList, ipcTaskUpdate } from '@/lib/ipc';

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  awaiting_human: 'Awaiting you',
  blocked: 'Blocked',
  done: 'Done',
  failed: 'Failed',
};

const STATUS_ORDER = ['awaiting_human', 'running', 'queued', 'blocked', 'failed', 'done'] as const;

interface TasksListProps {
  agentId: string;
}

/**
 * V1 Ledger task list for one agent. Hydrates from `task_list` on
 * mount; live updates via `agent:task_*` events.
 */
export function TasksList({ agentId }: TasksListProps): JSX.Element {
  const tasks = useAgentsStore((s) => s.tasksByAgent[agentId] ?? (EMPTY_ARRAY as Task[]));
  const setTasks = useAgentsStore((s) => s.setTasks);

  useQuery({
    queryKey: ['tasks', agentId],
    queryFn: async () => {
      const rows = await ipcTaskList(agentId);
      setTasks(agentId, rows);
      return rows;
    },
  });

  return (
    <div className="flex flex-col gap-3">
      {STATUS_ORDER.map((status) => {
        const group = tasks.filter((t) => t.status === status);
        if (group.length === 0) return null;
        return (
          <Section key={status} label={STATUS_LABELS[status] ?? status} count={group.length}>
            {group.map((task) => (
              <TaskRow key={task.id} task={task} agentId={agentId} />
            ))}
          </Section>
        );
      })}
      {tasks.length === 0 ? (
        <div className="rounded-card border border-line-2 bg-ink-2 p-3 text-12 text-text-tertiary">
          No tasks yet. Either type below to add one, or ask the agent to manage its own list via
          the <span className="font-mono text-text-secondary">{'<task>'}</span> tool.
        </div>
      ) : null}
      <AddTaskForm agentId={agentId} />
    </div>
  );
}

function Section({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-10 uppercase tracking-[0.12em] text-text-faint">
          {label}
        </span>
        <span className="font-mono text-10 text-text-faint">{count}</span>
      </div>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </div>
  );
}

function TaskRow({ task, agentId }: { task: Task; agentId: string }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const upsertTask = useAgentsStore((s) => s.upsertTask);
  const removeTask = useAgentsStore((s) => s.removeTask);
  const qc = useQueryClient();

  const update = useMutation({
    mutationFn: (input: { title?: string; status?: string }) =>
      ipcTaskUpdate({ taskId: task.id, ...input }),
    onSuccess: (next) => {
      upsertTask(next);
      void qc.invalidateQueries({ queryKey: ['tasks', agentId] });
    },
  });

  const remove = useMutation({
    mutationFn: () => ipcTaskDelete(task.id, agentId),
    onSuccess: () => removeTask(agentId, task.id),
  });

  const cycleStatus = (): void => {
    // Cheap status-cycle: queued → running → done → queued.
    const next =
      task.status === 'queued'
        ? 'running'
        : task.status === 'running'
          ? 'done'
          : task.status === 'done'
            ? 'queued'
            : task.status === 'blocked'
              ? 'queued'
              : 'queued';
    update.mutate({ status: next });
  };

  return (
    <li
      className={cn(
        'group flex items-start gap-2 rounded-card border border-line-2 bg-ink-2 p-2.5',
      )}
    >
      <button
        type="button"
        aria-label="Cycle status"
        onClick={cycleStatus}
        className={cn(
          'mt-0.5 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-[3px] border',
          task.status === 'done'
            ? 'border-status-running bg-status-running/15 text-status-running'
            : 'border-line-3 text-text-faint hover:border-line-4 hover:text-text-secondary',
        )}
      >
        {task.status === 'done' ? <CheckIcon className="h-2.5 w-2.5" /> : null}
      </button>
      <div className="flex flex-1 flex-col gap-1">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim().length > 0) {
                update.mutate({ title: draft.trim() });
                setEditing(false);
              } else if (e.key === 'Escape') {
                setDraft(task.title);
                setEditing(false);
              }
            }}
            onBlur={() => {
              if (draft.trim() === task.title || draft.trim().length === 0) {
                setDraft(task.title);
                setEditing(false);
              }
            }}
            className={cn(
              'rounded-[3px] border border-line-2 bg-ink-3 px-2 py-0.5 text-12 text-text-primary',
              'focus:border-line-3 focus:outline-none',
            )}
          />
        ) : (
          <span
            className={cn(
              'text-13',
              task.status === 'done' ? 'text-text-tertiary line-through' : 'text-text-primary',
            )}
          >
            {task.title}
          </span>
        )}
        {task.description ? (
          <span className="whitespace-pre-wrap text-11 text-text-tertiary">{task.description}</span>
        ) : null}
        <span className="flex items-center gap-1.5 text-10 text-text-faint">
          <span className="font-mono">{task.priority}</span>
          <span aria-hidden>·</span>
          <span className="font-mono">{task.status}</span>
        </span>
      </div>
      <span className="ml-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-fast group-hover:opacity-100">
        <button
          type="button"
          aria-label="Edit task"
          onClick={() => {
            setDraft(task.title);
            setEditing(true);
          }}
          className="rounded-[3px] p-1 text-text-faint hover:bg-hover hover:text-text-secondary"
        >
          <PencilIcon className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label="Delete task"
          onClick={() => remove.mutate()}
          className="rounded-[3px] p-1 text-text-faint hover:bg-hover hover:text-status-error"
        >
          <TrashIcon className="h-3 w-3" />
        </button>
      </span>
    </li>
  );
}

function AddTaskForm({ agentId }: { agentId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const upsertTask = useAgentsStore((s) => s.upsertTask);
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: () =>
      ipcTaskCreate({ agentId, title: title.trim(), status: 'queued', priority: 'normal' }),
    onSuccess: (task) => {
      upsertTask(task);
      void qc.invalidateQueries({ queryKey: ['tasks', agentId] });
      setTitle('');
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'self-start rounded-button border border-line-2 bg-ink-3 px-3 py-1.5',
          'text-12 text-text-secondary hover:bg-hover hover:text-text-primary',
        )}
      >
        <PlusIcon className="mr-1 inline-block h-3 w-3 -translate-y-px" />
        Add task
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && title.trim().length > 0) {
            create.mutate();
          } else if (e.key === 'Escape') {
            setTitle('');
            setOpen(false);
          }
        }}
        placeholder="Task title"
        className={cn(
          'flex-1 rounded-[3px] border border-line-2 bg-ink-3 px-2 py-1 text-12 text-text-primary',
          'placeholder:text-text-faint focus:border-line-3 focus:outline-none',
        )}
      />
      <button
        type="button"
        aria-label="Cancel"
        onClick={() => {
          setTitle('');
          setOpen(false);
        }}
        className="rounded-[3px] p-1 text-text-faint hover:bg-hover hover:text-text-secondary"
      >
        <XIcon className="h-3 w-3" />
      </button>
    </div>
  );
}
