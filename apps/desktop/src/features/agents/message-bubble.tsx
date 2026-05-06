import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, CheckIcon, XIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Message, ToolUseContent, UserOrAssistantContent } from '@orbit/types';
import type { StreamingToolCall } from '@/stores/agents';
import { useAgentsStore } from '@/stores/agents';

/**
 * Synthetic-user content emitted by the broker when agent A messages
 * agent B. Lives in `messages.content` JSON alongside the regular
 * UserOrAssistantContent shape.
 */
interface InboundUserContent {
  text: string;
  fromAgentId?: string;
  interAgentMessageId?: string;
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function UserMessageBubble({ text }: { text: string }): JSX.Element {
  return (
    <div className="flex justify-end">
      <div
        className={cn(
          'max-w-[80%] rounded-card bg-accent/15 px-3 py-2 text-13 text-text-primary',
          'whitespace-pre-wrap',
        )}
      >
        {text}
      </div>
    </div>
  );
}

/**
 * Inbound message bubble — agent A sent this to the agent whose chat
 * we're viewing. Visually distinct from human user messages: no
 * accent tint, instead a "from {AgentName}" label with the sender's
 * emoji/color, left-aligned, ink2 background. Per the V1 Ledger spec.
 */
export function InboundAgentBubble({
  text,
  fromAgentId,
}: {
  text: string;
  fromAgentId: string;
}): JSX.Element {
  const sender = useAgentsStore((s) => s.agents[fromAgentId] ?? null);
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-1.5 text-11 text-text-tertiary">
        <span aria-hidden className="orbit-emoji">
          {sender?.emoji ?? '✦'}
        </span>
        <span className="font-mono">from {sender?.name ?? 'agent'}</span>
      </div>
      <div
        className={cn(
          'max-w-[88%] rounded-card border border-line-2 bg-ink-2 px-3 py-2 text-13 text-text-primary',
          'whitespace-pre-wrap',
        )}
        style={{
          borderLeft: `2px solid ${sender?.color ?? 'var(--status-thinking)'}`,
        }}
      >
        {text}
      </div>
    </div>
  );
}

export function AssistantTextBubble({ text }: { text: string }): JSX.Element {
  return (
    <div className="flex justify-start">
      <div
        className={cn(
          'max-w-[88%] rounded-card bg-elevated px-3 py-2 text-13 text-text-primary',
          'whitespace-pre-wrap',
        )}
      >
        {text}
      </div>
    </div>
  );
}

interface ToolCallViewInput {
  toolId: string;
  toolName: string;
  input: unknown;
  result: string | null;
  isError: boolean;
  inFlight: boolean;
}

export function ToolCallBubble({ call }: { call: ToolCallViewInput }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeInput(call.toolName, call.input);
  const StatusIcon = call.inFlight ? null : call.isError ? XIcon : CheckIcon;
  return (
    <div
      className={cn(
        'rounded-card border text-13',
        call.isError ? 'border-status-error/40' : 'border-border-subtle',
        'bg-panel',
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDownIcon className="h-3 w-3 text-text-tertiary" />
        ) : (
          <ChevronRightIcon className="h-3 w-3 text-text-tertiary" />
        )}
        <span className="font-mono text-12 text-text-secondary">{call.toolName}</span>
        <span className="flex-1 truncate text-text-tertiary">{summary}</span>
        {call.inFlight ? (
          <span className="text-11 text-text-tertiary">running…</span>
        ) : StatusIcon ? (
          <StatusIcon
            className={cn('h-3 w-3', call.isError ? 'text-status-error' : 'text-status-active')}
          />
        ) : null}
      </button>
      {expanded ? (
        <div className="border-t border-border-subtle px-3 py-2">
          <div className="mb-2 text-11 uppercase tracking-wider text-text-tertiary">input</div>
          <pre className="overflow-x-auto rounded-input bg-elevated p-2 font-mono text-12 text-text-primary">
            {JSON.stringify(call.input, null, 2)}
          </pre>
          {call.result !== null ? (
            <>
              <div className="mb-2 mt-3 text-11 uppercase tracking-wider text-text-tertiary">
                result
              </div>
              <pre
                className={cn(
                  'overflow-x-auto rounded-input bg-elevated p-2 font-mono text-12',
                  call.isError ? 'text-status-error' : 'text-text-primary',
                )}
              >
                {call.result}
              </pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function summarizeInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  const path = obj.path ?? obj.file_path ?? obj.filePath;
  if (typeof path === 'string') {
    return `${toolName} ${path}`;
  }
  const command = obj.command ?? obj.cmd;
  if (typeof command === 'string') {
    return command.length > 80 ? `${command.slice(0, 80)}…` : command;
  }
  return '';
}

/** Render one persisted Message row. */
export function PersistedMessageBubble({ message }: { message: Message }): JSX.Element | null {
  switch (message.role) {
    case 'user': {
      const parsed = safeParse<InboundUserContent>(message.content, { text: '' });
      if (parsed.fromAgentId) {
        return <InboundAgentBubble text={parsed.text} fromAgentId={parsed.fromAgentId} />;
      }
      return <UserMessageBubble text={parsed.text} />;
    }
    case 'assistant': {
      const { text } = safeParse<UserOrAssistantContent>(message.content, { text: '' });
      return <AssistantTextBubble text={text} />;
    }
    case 'tool_use': {
      const parsed = safeParse<ToolUseContent>(message.content, {
        tool_id: '',
        tool_name: 'tool',
        input: {},
      });
      return (
        <ToolCallBubble
          call={{
            toolId: parsed.tool_id,
            toolName: parsed.tool_name,
            input: parsed.input,
            result: null,
            isError: false,
            inFlight: false,
          }}
        />
      );
    }
    case 'tool_result': {
      // Tool results merge into the preceding tool_use bubble at render
      // time; emit nothing on their own. The chat panel handles merging.
      return null;
    }
    default:
      return null;
  }
}

export function StreamingToolCallBubble({ call }: { call: StreamingToolCall }): JSX.Element {
  return (
    <ToolCallBubble
      call={{
        toolId: call.toolId,
        toolName: call.toolName,
        input: call.input,
        result: call.result,
        isError: call.isError,
        inFlight: call.result === null,
      }}
    />
  );
}
