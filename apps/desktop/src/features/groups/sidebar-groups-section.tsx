import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAgentsStore } from '@/stores/agents';
import { useUiStore } from '@/stores/ui-store';
import { ipcGroupThreadCreate } from '@/lib/ipc';

const GROUP_COLOR_PALETTE: readonly string[] = [
  '#3a4a3e',
  '#3a3e4a',
  '#4a4030',
  '#3a4548',
  '#48383f',
  '#454a3a',
];

/**
 * Sidebar "Group Chats" section. Click a group to open its
 * full-pane chat view; the `+` opens an inline name input.
 */
export function SidebarGroupsSection(): JSX.Element {
  const orderedIds = useAgentsStore((s) => s.orderedGroupThreadIds);
  const threads = useAgentsStore((s) => s.groupThreads);
  const selectedThreadId = useAgentsStore((s) => s.selectedGroupThreadId);
  const selectGroupThread = useAgentsStore((s) => s.selectGroupThread);
  const upsertGroupThread = useAgentsStore((s) => s.upsertGroupThread);
  const setCenterView = useUiStore((s) => s.setCenterView);
  const qc = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');

  const create = useMutation({
    mutationFn: (name: string) => {
      const color =
        GROUP_COLOR_PALETTE[orderedIds.length % GROUP_COLOR_PALETTE.length] ??
        GROUP_COLOR_PALETTE[0]!;
      return ipcGroupThreadCreate({ name, color });
    },
    onSuccess: (thread) => {
      upsertGroupThread(thread);
      void qc.invalidateQueries({ queryKey: ['group-threads'] });
      setDraftName('');
      setCreating(false);
      // Open the new thread immediately.
      selectGroupThread(thread.id);
      setCenterView('group-chat');
    },
  });

  const onPick = (threadId: string): void => {
    selectGroupThread(threadId);
    setCenterView('group-chat');
  };

  return (
    <section className="flex flex-col gap-1 px-2 pt-2">
      <header className="flex items-center justify-between px-2 pt-1">
        <span className="font-mono text-10 uppercase tracking-[0.12em] text-text-faint">
          Group chats
        </span>
        <button
          type="button"
          aria-label="Create group"
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
            placeholder="group name"
            className={cn(
              'flex-1 rounded-[3px] border border-line-2 bg-ink-3 px-2 py-1 text-12 text-text-primary',
              'placeholder:text-text-faint focus:border-line-3 focus:outline-none',
            )}
          />
        </div>
      ) : null}

      <ul className="flex flex-col">
        {orderedIds.length === 0 && !creating ? (
          <li className="px-2 py-1 text-11 text-text-faint">
            No groups yet. Coordinate multiple agents in one place.
          </li>
        ) : null}
        {orderedIds.map((id) => {
          const thread = threads[id];
          if (!thread) return null;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onPick(id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[3px] px-2 py-1 text-left',
                  'transition-colors duration-fast hover:bg-hover',
                  selectedThreadId === id && 'bg-ink-4',
                )}
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-[2px]"
                  style={{ background: thread.color }}
                />
                <span className="flex-1 truncate text-12 text-text-secondary">#{thread.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
