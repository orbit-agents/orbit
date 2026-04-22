import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Message } from '@orbit/types';
import { cn } from '@/lib/cn';
import { ipcAgentGetConversation, ipcAgentSendMessage } from '@/lib/ipc';
import { useAgentsStore } from '@/stores/agents';
import {
  AssistantTextBubble,
  PersistedMessageBubble,
  StreamingToolCallBubble,
} from './message-bubble';
import { ChatInput } from './chat-input';

export function AgentChatPanel(): JSX.Element {
  const activeAgentId = useAgentsStore((s) => s.activeAgentId);
  const agent = useAgentsStore((s) => (s.activeAgentId ? s.agents[s.activeAgentId] : null));
  const messages = useAgentsStore((s) =>
    s.activeAgentId ? (s.messagesByAgent[s.activeAgentId] ?? []) : [],
  );
  const streaming = useAgentsStore((s) =>
    s.activeAgentId ? s.streamingByAgent[s.activeAgentId] : null,
  );
  const lastError = useAgentsStore((s) =>
    s.activeAgentId ? s.lastErrorByAgent[s.activeAgentId] : null,
  );
  const setMessages = useAgentsStore((s) => s.setMessages);

  useQuery({
    queryKey: ['conversation', activeAgentId],
    queryFn: async () => {
      if (!activeAgentId) return [];
      const msgs = await ipcAgentGetConversation(activeAgentId);
      setMessages(activeAgentId, msgs);
      return msgs;
    },
    enabled: Boolean(activeAgentId),
  });

  const send = useMutation({
    mutationFn: async (text: string) => {
      if (!activeAgentId) return;
      await ipcAgentSendMessage(activeAgentId, text);
    },
  });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, streaming?.text, streaming?.toolCalls.length]);

  // Merge tool_use + tool_result rows so a single tool renders as one bubble.
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
        <span aria-hidden className="text-16">
          {agent.emoji}
        </span>
        <span className="text-13 font-medium text-text-primary">{agent.name}</span>
        <span className="text-11 text-text-tertiary">{agent.workingDir}</span>
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
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
        disabled={send.isPending || agent.status === 'active'}
        onSend={(text) => send.mutateAsync(text)}
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
