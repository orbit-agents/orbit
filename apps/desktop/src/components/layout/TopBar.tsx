import { cn } from '@/lib/cn';

/** Top bar with app title and map-tabs placeholder. */
export function TopBar(): JSX.Element {
  return (
    <header
      className={cn(
        'flex h-12 shrink-0 items-center gap-4 border-b border-border-subtle',
        'bg-panel px-4',
      )}
    >
      <div className="flex items-center gap-2">
        <div
          aria-hidden
          className="h-4 w-4 rounded-full bg-accent shadow-[0_0_12px_2px_var(--color-accent)]"
        />
        <span className="text-14 font-semibold tracking-tight text-text-primary">Orbit</span>
      </div>
      <nav className="flex items-center gap-1 text-13 text-text-secondary" aria-label="Maps">
        <span className="rounded-button bg-hover px-3 py-1 text-text-primary">default</span>
        <span className="text-text-tertiary">+ new map</span>
      </nav>
    </header>
  );
}
