import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { HelpCircleIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { DerivedStatus } from '@/stores/agents';

/**
 * Data field shape on the React Flow node — kept flat so the custom
 * comparator below can do cheap shallow equality without diving into
 * nested objects.
 */
export interface AgentNodeData extends Record<string, unknown> {
  agentId: string;
  name: string;
  emoji: string;
  color: string;
  currentTask: string;
  status: DerivedStatus;
  selected: boolean;
}

/**
 * Circular agent node with avatar, name, current task, status ring, and
 * optional help badge.
 *
 * React Flow re-renders nodes aggressively — on every pan, zoom, and
 * selection change. The custom `propsAreEqual` below skips re-renders
 * unless a visible field actually changed.
 */
function AgentNodeImpl({ data }: NodeProps): JSX.Element {
  const d = data as AgentNodeData;
  const ring = ringClass(d.status);
  const help = d.status === 'waiting_for_human';

  return (
    <div className="flex flex-col items-center gap-2" data-agent-id={d.agentId}>
      <div className="relative">
        {/* Selection ring — 1px outer, 4px offset, accent. */}
        {d.selected ? (
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-[5px] rounded-full ring-1 ring-accent"
          />
        ) : null}

        {/* Status ring */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 rounded-full',
            ring.outline,
            ring.pulse && 'orbit-pulse',
          )}
        />

        {/* Avatar */}
        <div
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full',
            'border border-border-subtle shadow-[0_1px_0_rgba(255,255,255,0.02)_inset]',
            'select-none transition-shadow duration-[150ms] ease-out',
            'hover:shadow-card',
          )}
          style={{ backgroundColor: `${d.color}26` }}
        >
          <span className="orbit-emoji text-[26px] leading-none">{d.emoji}</span>
        </div>

        {/* Help badge — amber "?" top-right */}
        {help ? (
          <span
            className={cn(
              'absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center',
              'rounded-full bg-status-waiting text-panel',
            )}
            aria-label="Waiting for a human response"
            role="img"
          >
            <HelpCircleIcon className="h-3 w-3" strokeWidth={2.5} />
          </span>
        ) : null}
      </div>

      <span className="max-w-[168px] truncate text-13 font-medium text-text-primary">{d.name}</span>

      <span
        className="max-w-[160px] truncate text-11 text-text-tertiary"
        style={{ fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, monospace' }}
      >
        {d.currentTask}
      </span>
    </div>
  );
}

interface RingDef {
  outline: string;
  pulse: boolean;
}

function ringClass(status: DerivedStatus): RingDef {
  switch (status) {
    case 'active':
      return { outline: 'ring-2 ring-status-active', pulse: true };
    case 'waiting_for_human':
      return { outline: 'ring-2 ring-status-waiting', pulse: false };
    case 'error':
      return { outline: 'ring-2 ring-status-error', pulse: false };
    case 'idle':
    default:
      return { outline: 'ring-0 ring-transparent', pulse: false };
  }
}

/** Only re-render when a field that affects visuals actually changes. */
function propsAreEqual(prev: NodeProps, next: NodeProps): boolean {
  const a = prev.data as AgentNodeData;
  const b = next.data as AgentNodeData;
  if (prev.dragging !== next.dragging) return false;
  return (
    a.name === b.name &&
    a.emoji === b.emoji &&
    a.color === b.color &&
    a.currentTask === b.currentTask &&
    a.status === b.status &&
    a.selected === b.selected
  );
}

export const AgentNode = memo(AgentNodeImpl, propsAreEqual);
