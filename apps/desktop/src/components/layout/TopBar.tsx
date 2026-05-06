import { cn } from '@/lib/cn';
import { OrbitMark } from '@/components/orbit-mark';

/**
 * Title bar — V1 Ledger spec.
 * 36px tall, ink1 background, line0 bottom border. Traffic-light dots
 * on the left, brand mark + wordmark, then map tabs (mono 11px).
 */
export function TopBar(): JSX.Element {
  return (
    <header className={cn('flex h-9 shrink-0 items-center border-b border-line-0 bg-ink-1 px-3')}>
      <div className="flex w-[78px] items-center gap-2">
        <span aria-hidden className="h-[11px] w-[11px] rounded-full bg-line-4" />
        <span aria-hidden className="h-[11px] w-[11px] rounded-full bg-line-4" />
        <span aria-hidden className="h-[11px] w-[11px] rounded-full bg-line-4" />
      </div>
      <div className="mr-2 flex h-[22px] items-center gap-[6px] border-r border-line-2 pr-3">
        <OrbitMark size={16} />
        <span
          className="text-text-primary"
          style={{ fontSize: 12, fontWeight: 600, letterSpacing: -0.1 }}
        >
          orbit
        </span>
      </div>
      <nav
        aria-label="Maps"
        className="flex flex-1 items-center gap-[2px] font-mono text-11 text-text-tertiary"
      >
        <span
          className={cn(
            'rounded-[4px] border border-line-3 bg-ink-5 px-[10px] py-1',
            'text-text-primary',
          )}
        >
          default
        </span>
        <span className="cursor-pointer rounded-[4px] px-2 py-1 hover:bg-hover">+</span>
      </nav>
    </header>
  );
}
