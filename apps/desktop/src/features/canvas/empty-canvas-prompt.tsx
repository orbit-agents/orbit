import { cn } from '@/lib/cn';
import { ArrowDownRightIcon } from 'lucide-react';

/**
 * Shown when the canvas is empty — the user has not spawned any agents
 * yet. Fades out once the first agent exists.
 */
export function EmptyCanvasPrompt(): JSX.Element {
  return (
    <div
      className={cn('pointer-events-none absolute inset-0 flex items-center justify-center')}
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="text-16 text-text-secondary">
          Click anywhere to spawn your first agent
        </span>
        <span className="text-12 text-text-tertiary">
          or press{' '}
          <kbd className="rounded-input border border-border bg-elevated px-1.5 py-0.5 font-mono text-11">
            {'Cmd/Ctrl+Shift+N'}
          </kbd>
        </span>
        <ArrowDownRightIcon
          className="mt-2 h-5 w-5 animate-bounce text-text-tertiary"
          aria-hidden
        />
      </div>
    </div>
  );
}
