import { cn } from '@/lib/cn';
import { useAgentsStore } from '@/stores/agents';

const SOFT_THRESHOLD = 8;
const HARD_LIMIT = 10;

/**
 * Floating pill that surfaces the soft 10-agent cap as users approach
 * it. Hidden under 8 agents, muted at 8–9, amber at 10. Sits above the
 * canvas toolbar so the warning is visible regardless of the user's
 * pan / zoom position.
 */
export function AgentCountPill(): JSX.Element | null {
  const count = useAgentsStore((s) => s.orderedAgentIds.length);
  if (count < SOFT_THRESHOLD) return null;

  const atLimit = count >= HARD_LIMIT;

  return (
    <div
      className={cn(
        // Sits just above the floating CanvasToolbar (which is ~280px
        // tall with 7 buttons + 2 separators + padding).
        'absolute right-4 bottom-[300px] flex items-center gap-2',
        'rounded-input border px-3 py-1 text-11 shadow-card',
        atLimit
          ? 'border-status-waiting/40 bg-status-waiting/10 text-status-waiting'
          : 'border-border-subtle bg-elevated text-text-secondary',
      )}
      role="status"
    >
      <span aria-hidden className="font-medium">
        {count}/{HARD_LIMIT}
      </span>
      <span>
        {atLimit
          ? 'Agent limit reached — terminate one to spawn more.'
          : 'agents — running near the limit.'}
      </span>
    </div>
  );
}
