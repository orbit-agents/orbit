import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TrashIcon, UserPlusIcon } from 'lucide-react';
import type { GroupMessage } from '@orbit/types';
import { cn } from '@/lib/cn';
import { useAgentsStore } from '@/stores/agents';
import { useUiStore } from '@/stores/ui-store';
import {
  ipcGroupThreadAddMember,
  ipcGroupThreadDelete,
  ipcGroupThreadListMembers,
  ipcGroupThreadListMessages,
  ipcGroupThreadPostMessage,
  ipcGroupThreadRemoveMember,
} from '@/lib/ipc';

/**
 * V1 Ledger group-chat full-pane view. Replaces the canvas when the
 * user picks a group from the sidebar. Header shows members + add
 * affordance, transcript shows attributed messages, composer at the
 * bottom for the human.
 */
export function GroupChatView(): JSX.Element {
  const threadId = useAgentsStore((s) => s.selectedGroupThreadId);
  const thread = useAgentsStore((s) => (threadId ? (s.groupThreads[threadId] ?? null) : null));
  const setCenterView = useUiStore((s) => s.setCenterView);

  if (!threadId || !thread) {
    return (
      <div className="flex h-full items-center justify-center bg-app text-13 text-text-tertiary">
        No group selected.
      </div>
    );
  }

  return <GroupChatBody key={threadId} threadId={threadId} setCenterView={setCenterView} />;
}

function GroupChatBody({
  threadId,
  setCenterView,
}: {
  threadId: string;
  setCenterView: (v: 'canvas' | 'task-inbox' | 'group-chat' | 'mcp-settings') => void;
}): JSX.Element {
  const thread = useAgentsStore((s) => s.groupThreads[threadId]);
  const agents = useAgentsStore((s) => s.agents);
  const messages = useAgentsStore((s) => s.groupMessagesByThread[threadId] ?? []);
  const setGroupMessages = useAgentsStore((s) => s.setGroupMessages);
  const setGroupMembers = useAgentsStore((s) => s.setGroupMembers);
  const removeGroupThread = useAgentsStore((s) => s.removeGroupThread);
  const memberIds = useAgentsStore((s) => s.groupMembersByThread[threadId] ?? []);
  const qc = useQueryClient();

  useQuery({
    queryKey: ['group-messages', threadId],
    queryFn: async () => {
      const rows = await ipcGroupThreadListMessages(threadId, 500);
      setGroupMessages(threadId, rows);
      return rows;
    },
  });
  useQuery({
    queryKey: ['group-members', threadId],
    queryFn: async () => {
      const rows = await ipcGroupThreadListMembers(threadId);
      setGroupMembers(
        threadId,
        rows.map((r) => r.agentId),
      );
      return rows;
    },
  });

  const [draft, setDraft] = useState('');
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const post = useMutation({
    mutationFn: () => ipcGroupThreadPostMessage(threadId, draft.trim()),
    onSuccess: () => {
      setDraft('');
      void qc.invalidateQueries({ queryKey: ['group-messages', threadId] });
    },
  });

  const onComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && draft.trim().length > 0) {
      post.mutate();
    }
  };

  const transcriptRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const remove = useMutation({
    mutationFn: () => ipcGroupThreadDelete(threadId),
    onSuccess: () => {
      removeGroupThread(threadId);
      setCenterView('canvas');
    },
  });

  return (
    <div className="flex h-full flex-col bg-app">
      <header className="flex items-center gap-2 border-b border-line-0 px-4 py-2.5">
        <span
          aria-hidden
          className="h-2.5 w-2.5 flex-shrink-0 rounded-[2px]"
          style={{ background: thread?.color ?? 'var(--line2)' }}
        />
        <span className="text-13 font-medium text-text-primary">{thread?.name}</span>
        <span className="ml-2 font-mono text-11 text-text-faint">
          {memberIds.length} {memberIds.length === 1 ? 'member' : 'members'}
        </span>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Delete this group thread? Messages will be lost.')) {
              remove.mutate();
            }
          }}
          className="ml-auto rounded-[3px] p-1 text-text-faint hover:bg-hover hover:text-status-error"
          aria-label="Delete group"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </header>

      <MemberStrip threadId={threadId} memberIds={memberIds} />

      <div ref={transcriptRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-[720px] flex-col gap-3">
          {messages.length === 0 ? (
            <div className="rounded-card border border-line-2 bg-ink-2 p-3 text-12 text-text-tertiary">
              No messages yet. Add members above and post below — every member gets a synthetic user
              turn.
            </div>
          ) : null}
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} agents={agents} />
          ))}
        </div>
      </div>

      <div className="border-t border-line-0 bg-ink-1 p-3">
        <div className="mx-auto flex max-w-[720px] items-end gap-2">
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKey}
            rows={2}
            placeholder="Message the group… (Cmd/Ctrl+Enter to send)"
            className={cn(
              'flex-1 resize-none rounded-input border border-line-2 bg-ink-3 px-3 py-2',
              'text-13 text-text-primary placeholder:text-text-faint focus:border-line-3 focus:outline-none',
            )}
          />
          <button
            type="button"
            disabled={post.isPending || draft.trim().length === 0}
            onClick={() => post.mutate()}
            className={cn(
              'rounded-button bg-accent px-3 py-2 text-13 font-medium text-white',
              'disabled:opacity-40',
            )}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function MemberStrip({
  threadId,
  memberIds,
}: {
  threadId: string;
  memberIds: readonly string[];
}): JSX.Element {
  const allAgents = useAgentsStore((s) => s.agents);
  const orderedAgentIds = useAgentsStore((s) => s.orderedAgentIds);
  const setGroupMembers = useAgentsStore((s) => s.setGroupMembers);
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const memberSet = new Set(memberIds);
  const eligible = orderedAgentIds.filter((id) => !memberSet.has(id));

  const add = useMutation({
    mutationFn: (agentId: string) => ipcGroupThreadAddMember(threadId, agentId),
    onSuccess: (_r, agentId) => {
      setGroupMembers(threadId, [...memberIds, agentId]);
      void qc.invalidateQueries({ queryKey: ['group-members', threadId] });
      setAdding(false);
    },
  });
  const removeMember = useMutation({
    mutationFn: (agentId: string) => ipcGroupThreadRemoveMember(threadId, agentId),
    onSuccess: (_r, agentId) => {
      setGroupMembers(
        threadId,
        memberIds.filter((id) => id !== agentId),
      );
      void qc.invalidateQueries({ queryKey: ['group-members', threadId] });
    },
  });

  return (
    <div className="flex items-center gap-2 border-b border-line-0 bg-ink-1 px-4 py-2">
      <span className="font-mono text-10 uppercase tracking-[0.12em] text-text-faint">Members</span>
      <ul className="flex flex-wrap items-center gap-1">
        {memberIds.map((id) => {
          const a = allAgents[id];
          if (!a) return null;
          return (
            <li key={id}>
              <span
                className={cn(
                  'group inline-flex items-center gap-1 rounded-[3px] border border-line-2 bg-ink-2',
                  'px-1.5 py-0.5 text-11',
                )}
              >
                <span aria-hidden className="orbit-emoji">
                  {a.emoji}
                </span>
                <span className="text-text-primary">{a.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => removeMember.mutate(id)}
                  className="opacity-0 transition-opacity duration-fast hover:text-status-error group-hover:opacity-100"
                >
                  ×
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="ml-auto">
        {adding ? (
          eligible.length === 0 ? (
            <span className="text-11 text-text-faint">No agents to add</span>
          ) : (
            <select
              autoFocus
              onChange={(e) => {
                if (e.target.value) add.mutate(e.target.value);
              }}
              onBlur={() => setAdding(false)}
              className="rounded-[3px] border border-line-2 bg-ink-3 px-2 py-0.5 text-11 text-text-primary"
              defaultValue=""
            >
              <option value="" disabled>
                Pick an agent…
              </option>
              {eligible.map((id) => {
                const a = allAgents[id];
                return (
                  <option key={id} value={id}>
                    {a?.name ?? id}
                  </option>
                );
              })}
            </select>
          )
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={cn(
              'rounded-[3px] border border-line-2 bg-ink-3 px-2 py-0.5 text-11 text-text-secondary',
              'hover:bg-hover hover:text-text-primary',
            )}
          >
            <UserPlusIcon className="mr-1 inline-block h-3 w-3 -translate-y-px" />
            Add
          </button>
        )}
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  agents,
}: {
  msg: GroupMessage;
  agents: Record<string, { id: string; name: string; emoji: string; color: string }>;
}): JSX.Element {
  if (msg.senderKind === 'human') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-card bg-accent/15 px-3 py-2 text-13 text-text-primary">
          {msg.content}
        </div>
      </div>
    );
  }
  const sender = msg.senderAgentId ? agents[msg.senderAgentId] : undefined;
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-1.5 text-11 text-text-tertiary">
        <span aria-hidden className="orbit-emoji">
          {sender?.emoji ?? '✦'}
        </span>
        <span className="font-mono">{sender?.name ?? 'agent'}</span>
        <span aria-hidden className="ml-1 text-text-faint">
          {timeOnly(msg.createdAt)}
        </span>
      </div>
      <div
        className="max-w-[88%] whitespace-pre-wrap rounded-card border border-line-2 bg-ink-2 px-3 py-2 text-13 text-text-primary"
        style={{ borderLeft: `2px solid ${sender?.color ?? 'var(--status-thinking)'}` }}
      >
        {msg.content}
      </div>
    </div>
  );
}

function timeOnly(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
