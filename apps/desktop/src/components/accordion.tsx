import { useState, useId, useCallback, type ReactNode } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface AccordionSectionProps {
  /** Section title shown in the header. */
  title: string;
  /** One-line summary visible only when the section is collapsed. */
  summary?: ReactNode;
  /** Right-side header slot (e.g. "Saved" / "Identity pending" pill). */
  rightSlot?: ReactNode;
  /** Whether the section is open by default. */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Single accordion section. Custom rather than from a UI library — the
 * Settings tab needs five of these and we don't already pull shadcn or
 * Radix into Orbit. Keyboard accessible (Enter/Space toggles), aria
 * fields wired up, no animation library required.
 */
export function AccordionSection({
  title,
  summary,
  rightSlot,
  defaultOpen = false,
  children,
}: AccordionSectionProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const headerId = useId();
  const panelId = useId();

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    },
    [toggle],
  );

  return (
    <section className="border-b border-border-subtle last:border-b-0">
      <button
        type="button"
        id={headerId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        onKeyDown={onKey}
        className={cn(
          'flex w-full items-center gap-2 px-4 py-3 text-left',
          'text-13 font-medium text-text-primary',
          'hover:bg-hover transition-colors duration-fast',
        )}
      >
        <ChevronRightIcon
          className={cn(
            'h-3.5 w-3.5 text-text-tertiary transition-transform duration-fast',
            open && 'rotate-90',
          )}
          aria-hidden
        />
        <span className="flex-1">{title}</span>
        {!open && summary ? (
          <span className="truncate text-11 text-text-tertiary">{summary}</span>
        ) : null}
        {rightSlot ? <span className="ml-auto">{rightSlot}</span> : null}
      </button>
      {open ? (
        <div id={panelId} role="region" aria-labelledby={headerId} className="px-4 pb-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}
