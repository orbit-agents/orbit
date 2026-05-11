import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Message } from '@orbit/types';
import { cn } from '@/lib/cn';
import { ipcAgentGetConversation, ipcAgentSendMessage } from '@/lib/ipc';
import { useAgentsStore } from '@/stores/agents';
import { EMPTY_ARRAY } from '@/lib/stable-empty';
import {
  AssistantTextBubble,
  PersistedMessageBubble,
  StreamingToolCallBubble,
} from './message-bubble';
import { ChatInput } from './chat-input';

export function AgentChatPanel(): JSX.Element {
  const selectedAgentId = useAgentsStore((s) => s.selectedAgentId);
  const agent = useAgentsStore((s) => (s.selectedAgentId ? s.agents[s.selectedAgentId] : null));
  const messages = useAgentsStore(
    (s) =>
      (s.selectedAgentId ? s.messagesByAgent[s.selectedAgentId] : undefined) ??
      (EMPTY_ARRAY as Message[]),
  );
  const streaming = useAgentsStore((s) =>
    s.selectedAgentId ? s.streamingByAgent[s.selectedAgentId] : null,
  );
  const lastError = useAgentsStore((s) =>
    s.selectedAgentId ? s.lastErrorByAgent[s.selectedAgentId] : null,
  );
  const setMessages = useAgentsStore((s) => s.setMessages);

  // Per-agent draft + scroll.
  const draft = useAgentsStore((s) =>
    s.selectedAgentId ? (s.chatDraftByAgent[s.selectedAgentId] ?? '') : '',
  );
  const savedScroll = useAgentsStore((s) =>
    s.selectedAgentId ? (s.chatScrollByAgent[s.selectedAgentId] ?? null) : null,
  );
  const setChatDraft = useAgentsStore((s) => s.setChatDraft);
  const setChatScroll = useAgentsStore((s) => s.setChatScroll);

  useQuery({
    queryKey: ['conversation', selectedAgentId],
    queryFn: async () => {
      if (!selectedAgentId) return [];
      const msgs = await ipcAgentGetConversation(selectedAgentId);
      setMessages(selectedAgentId, msgs);
      return msgs;
    },
    enabled: Boolean(selectedAgentId),
  });

  const send = useMutation({
    mutationFn: async (text: string) => {
      if (!selectedAgentId) return;
      await ipcAgentSendMessage(selectedAgentId, text);
    },
  });

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Restore per-agent scroll position synchronously on agent switch so
  // the user doesn't see the scroll jump during the render.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !selectedAgentId) return;
    if (savedScroll !== null) {
      el.scrollTop = savedScroll;
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [selectedAgentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-pin to the bottom while streaming, unless the user has
  // scrolled up (we check a 40px threshold so small jitter doesn't
  // disable auto-scroll).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (pinned) el.scrollTop = el.scrollHeight;
  }, [messages.length, streaming?.text, streaming?.toolCalls.length]);

  // Persist scroll offset to the store on user scroll.
  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el || !selectedAgentId) return;
    setChatScroll(selectedAgentId, el.scrollTop);
  };

  const mergedRows = useMemo(() => mergeToolPairs(messages), [messages]);

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center text-13 text-text-tertiary">
        No agent selected.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border-subtle bg-panel px-4 py-2">
        <span aria-hidden className="orbit-emoji text-16">
          {agent.emoji}
        </span>
        <span className="text-13 font-medium text-text-primary">{agent.name}</span>
        <span className="truncate text-11 text-text-tertiary">{agent.workingDir}</span>
        <span
          className={cn(
            'ml-auto rounded-input px-2 py-0.5 text-11',
            agent.status === 'active'
              ? 'bg-status-active/15 text-status-active'
              : agent.status === 'error'
                ? 'bg-status-error/15 text-status-error'
                : 'bg-hover text-text-secondary',
          )}
        >
          {agent.status}
        </span>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-3">
        <div className="mx-auto flex max-w-[720px] flex-col gap-3">
          {mergedRows.map((row) => {
            if (row.kind === 'plain') {
              return <PersistedMessageBubble key={row.id} message={row.message} />;
            }
            return (
              <StreamingToolCallBubble
                key={row.id}
                call={{
                  toolId: row.toolId,
                  toolName: row.toolName,
                  input: row.input,
                  complete: true,
                  result: row.result,
                  isError: row.isError,
                }}
              />
            );
          })}

          {streaming && streaming.toolCalls.length > 0 ? (
            <>
              {streaming.toolCalls.map((c) => (
                <StreamingToolCallBubble key={c.toolId} call={c} />
              ))}
            </>
          ) : null}

          {streaming && streaming.text ? <AssistantTextBubble text={streaming.text} /> : null}

          {lastError ? (
            <div className="rounded-card border border-status-error/40 bg-status-error/10 px-3 py-2 text-13 text-status-error">
              {lastError}
            </div>
          ) : null}
        </div>
      </div>

      <ChatInput
        value={draft}
        onChange={(v) => selectedAgentId && setChatDraft(selectedAgentId, v)}
        disabled={send.isPending || agent.status === 'active'}
        onSend={(text) => send.mutateAsync(text)}
        focusKey={selectedAgentId ?? 'none'}
      />
    </div>
  );
}

interface PlainRow {
  kind: 'plain';
  id: string;
  message: Message;
}
interface MergedToolRow {
  kind: 'tool';
  id: string;
  toolId: string;
  toolName: string;
  input: unknown;
  result: string | null;
  isError: boolean;
}
type Row = PlainRow | MergedToolRow;

function mergeToolPairs(messages: Message[]): Row[] {
  type ParsedUse = { tool_id: string; tool_name: string; input: unknown };
  type ParsedResult = { tool_id: string; result: string; is_error: boolean };

  const out: Row[] = [];
  const openByToolId = new Map<string, number>();

  for (const m of messages) {
    if (m.role === 'tool_use') {
      try {
        const p = JSON.parse(m.content) as ParsedUse;
        const row: MergedToolRow = {
          kind: 'tool',
          id: m.id,
          toolId: p.tool_id,
          toolName: p.tool_name,
          input: p.input,
          result: null,
          isError: false,
        };
        openByToolId.set(p.tool_id, out.length);
        out.push(row);
      } catch {
        out.push({ kind: 'plain', id: m.id, message: m });
      }
      continue;
    }
    if (m.role === 'tool_result') {
      try {
        const p = JSON.parse(m.content) as ParsedResult;
        const idx = openByToolId.get(p.tool_id);
        if (idx !== undefined) {
          const existing = out[idx];
          if (existing && existing.kind === 'tool') {
            out[idx] = {
              ...existing,
              result: p.result,
              isError: p.is_error,
            };
          }
        }
      } catch {
        // Silently drop malformed tool_result rows.
      }
      continue;
    }
    out.push({ kind: 'plain', id: m.id, message: m });
  }
  return out;
}
