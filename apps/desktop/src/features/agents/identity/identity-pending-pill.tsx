import { cn } from '@/lib/cn';

/**
 * Small pill rendered next to the agent name in the right panel header
 * whenever soul/purpose/memory has been edited but the running agent
 * hasn't picked up the change yet (it does on the next user message).
 *
 * Per the Phase 3 design rule: "Identity pending" wins precedence over
 * any "Saved" toast — the user's mental model is "the agent doesn't
 * know yet" until the next send clears the dirty flag.
 */
export function IdentityPendingPill(): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-input bg-status-waiting/15 px-2 py-0.5',
        'text-11 text-status-waiting',
      )}
      title="Soul / Purpose / Memory edits will be sent to the running agent on the next message."
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-status-waiting" />
      Identity pending
    </span>
  );
}
