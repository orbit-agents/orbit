import { useReactFlow } from '@xyflow/react';
import {
  LayoutGridIcon,
  MaximizeIcon,
  PlusIcon,
  RotateCcwIcon,
  UsersIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';

interface ButtonProps {
  onClick?: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  title?: string;
}

function ToolbarButton({ onClick, icon: Icon, label, disabled, title }: ButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-button',
        'text-text-secondary hover:bg-hover hover:text-text-primary',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
        'transition-colors duration-fast',
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function Separator(): JSX.Element {
  return <span aria-hidden className="my-1 h-px bg-border-subtle" />;
}

/**
 * Floating toolbar pinned to the bottom-right of the canvas. Deliberately
 * replaces React Flow's default `<Controls />` so our visual language
 * stays consistent with the rest of Orbit.
 */
export function CanvasToolbar(): JSX.Element {
  const flow = useReactFlow();
  return (
    <div
      className={cn(
        'absolute bottom-4 right-4 flex flex-col gap-1',
        'rounded-panel border border-border-subtle bg-elevated p-1 shadow-card',
      )}
      role="toolbar"
      aria-label="Canvas controls"
    >
      <ToolbarButton
        icon={ZoomInIcon}
        label="Zoom in"
        onClick={() => flow.zoomIn({ duration: 180 })}
      />
      <ToolbarButton
        icon={ZoomOutIcon}
        label="Zoom out"
        onClick={() => flow.zoomOut({ duration: 180 })}
      />
      <ToolbarButton
        icon={MaximizeIcon}
        label="Fit to view"
        onClick={() => flow.fitView({ padding: 0.2, duration: 260 })}
      />
      <ToolbarButton
        icon={RotateCcwIcon}
        label="Reset zoom"
        onClick={() => flow.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 260 })}
      />
      <Separator />
      <ToolbarButton
        icon={UsersIcon}
        label="Create team (Phase 5)"
        title="Create team — coming in Phase 5"
        disabled
      />
      <ToolbarButton
        icon={LayoutGridIcon}
        label="Sticky note (Phase 7)"
        title="Sticky note — coming in Phase 7"
        disabled
      />
      <Separator />
      <ToolbarButton icon={PlusIcon} label="Toolbar idle indicator" disabled title="" />
    </div>
  );
}
