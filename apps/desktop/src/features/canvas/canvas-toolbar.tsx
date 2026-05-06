import { useReactFlow } from '@xyflow/react';
import {
  MaximizeIcon,
  PlusIcon,
  RotateCcwIcon,
  StickyNoteIcon,
  UsersIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { ipcStickyNoteCreate } from '@/lib/ipc';
import { useAgentsStore } from '@/stores/agents';

const STICKY_COLOR_PALETTE: readonly string[] = [
  '#3b3825',
  '#3a3825',
  '#3d3a25',
  '#3a3a28',
  '#3d3522',
  '#382f25',
];

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
  const upsertStickyNote = useAgentsStore((s) => s.upsertStickyNote);
  const createStickyAtCenter = (): void => {
    // Drop the new note at the current viewport center.
    const vp = flow.getViewport();
    const screenCx = window.innerWidth / 2;
    const screenCy = window.innerHeight / 2;
    const center = flow.screenToFlowPosition({ x: screenCx, y: screenCy });
    void vp; // viewport already factored into screenToFlowPosition
    const x = Math.round((center.x - 84) / 20) * 20;
    const y = Math.round((center.y - 32) / 20) * 20;
    const color =
      STICKY_COLOR_PALETTE[Math.floor(Math.random() * STICKY_COLOR_PALETTE.length)] ??
      STICKY_COLOR_PALETTE[0]!;
    void ipcStickyNoteCreate({ content: '', positionX: x, positionY: y, color })
      .then((note) => upsertStickyNote(note))
      .catch((err) => console.warn('failed to create sticky note', err));
  };
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
        onClick={() => {
          void flow.zoomIn({ duration: 180 });
        }}
      />
      <ToolbarButton
        icon={ZoomOutIcon}
        label="Zoom out"
        onClick={() => {
          void flow.zoomOut({ duration: 180 });
        }}
      />
      <ToolbarButton
        icon={MaximizeIcon}
        label="Fit to view"
        onClick={() => {
          void flow.fitView({ padding: 0.2, duration: 260 });
        }}
      />
      <ToolbarButton
        icon={RotateCcwIcon}
        label="Reset zoom"
        onClick={() => {
          void flow.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 260 });
        }}
      />
      <Separator />
      <ToolbarButton
        icon={UsersIcon}
        label="Create team (Phase 5)"
        title="Create team — coming in Phase 5"
        disabled
      />
      <ToolbarButton
        icon={StickyNoteIcon}
        label="Add sticky note"
        title="Add sticky note (or shift-click empty canvas)"
        onClick={createStickyAtCenter}
      />
      <Separator />
      <ToolbarButton icon={PlusIcon} label="Toolbar idle indicator" disabled title="" />
    </div>
  );
}
