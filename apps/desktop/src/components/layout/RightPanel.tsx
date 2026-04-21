import { cn } from '@/lib/cn';

/** Right detail panel. Content is stubbed; chat + agent details land in later phases. */
export function RightPanel(): JSX.Element {
  return (
    <aside
      className={cn('flex h-full flex-col bg-panel', 'border-l border-border-subtle')}
      aria-label="Detail panel"
    >
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2">
        <span className="text-13 font-medium text-text-primary">Details</span>
        <span className="text-11 text-text-tertiary">Phase 1</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 text-13 text-text-secondary">
        Select an agent, conversation, or task to see details here.
      </div>
    </aside>
  );
}
