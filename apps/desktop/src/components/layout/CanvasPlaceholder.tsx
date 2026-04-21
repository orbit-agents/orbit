import { cn } from '@/lib/cn';

/** Dark area with a dot-grid background. React Flow integration lands in Phase 2. */
export function CanvasPlaceholder(): JSX.Element {
  return (
    <div
      className={cn('relative h-full w-full bg-app', 'bg-dot-grid bg-[size:20px_20px]')}
      role="region"
      aria-label="Canvas"
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-13 text-text-tertiary">canvas — Phase 2</span>
      </div>
    </div>
  );
}
