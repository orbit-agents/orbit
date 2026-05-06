import { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { XIcon } from 'lucide-react';
import type { StickyNote } from '@orbit/types';
import { cn } from '@/lib/cn';
import { useAgentsStore } from '@/stores/agents';
import { ipcStickyNoteDelete, ipcStickyNoteUpdate } from '@/lib/ipc';

/**
 * Sticky-note overlay above the dotted backdrop, below agent nodes.
 * Each note is a draggable card with content + remove button. Per
 * the V1 Ledger spec sticky notes are a human-only canvas
 * annotation — agents never see them.
 */
const NOTE_WIDTH = 168;
const NOTE_MIN_HEIGHT = 64;
const SNAP_STEP = 20;

export function StickyNoteLayer(): JSX.Element | null {
  const notes = useAgentsStore((s) => s.stickyNotes);
  const ids = Object.keys(notes);
  if (ids.length === 0) return null;
  return (
    <div aria-hidden={false} className="pointer-events-none absolute inset-0" style={{ zIndex: 4 }}>
      {ids.map((id) => {
        const n = notes[id];
        if (!n) return null;
        return <StickyNoteCard key={id} note={n} />;
      })}
    </div>
  );
}

function StickyNoteCard({ note }: { note: StickyNote }): JSX.Element {
  const flow = useReactFlow();
  const upsertStickyNote = useAgentsStore((s) => s.upsertStickyNote);
  const removeStickyNote = useAgentsStore((s) => s.removeStickyNote);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);

  // Convert the note's canvas-space coords into screen pixels via
  // React Flow's viewport transform.
  const screen = flow.flowToScreenPosition({ x: note.positionX, y: note.positionY });

  const persistContent = (next: string): void => {
    if (next === note.content) return;
    upsertStickyNote({ ...note, content: next });
    void ipcStickyNoteUpdate({ noteId: note.id, content: next }).catch((e) => {
      console.warn('failed to update sticky note content', e);
    });
  };

  const persistPosition = (x: number, y: number): void => {
    upsertStickyNote({ ...note, positionX: x, positionY: y });
    void ipcStickyNoteUpdate({ noteId: note.id, positionX: x, positionY: y }).catch((e) => {
      console.warn('failed to update sticky note position', e);
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (editing) return;
    if ((e.target as HTMLElement).closest('button, textarea, input')) return;
    e.preventDefault();
    const flowPoint = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setDragOffset({ dx: flowPoint.x - note.positionX, dy: flowPoint.y - note.positionY });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragOffset) return;
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const x = p.x - dragOffset.dx;
    const y = p.y - dragOffset.dy;
    upsertStickyNote({ ...note, positionX: x, positionY: y });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragOffset) return;
    setDragOffset(null);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    // Snap to grid then persist.
    const sx = Math.round(note.positionX / SNAP_STEP) * SNAP_STEP;
    const sy = Math.round(note.positionY / SNAP_STEP) * SNAP_STEP;
    if (sx !== note.positionX || sy !== note.positionY) {
      upsertStickyNote({ ...note, positionX: sx, positionY: sy });
    }
    persistPosition(sx, sy);
  };

  // Auto-resize textarea to content when editing.
  useEffect(() => {
    if (!editing) return;
    const el = containerRef.current?.querySelector('textarea');
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editing, draft]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'pointer-events-auto absolute group select-none rounded-card border border-line-2 shadow-card',
        'transition-shadow duration-fast hover:shadow-drag',
      )}
      style={{
        left: screen.x,
        top: screen.y,
        width: NOTE_WIDTH,
        minHeight: NOTE_MIN_HEIGHT,
        background: note.color,
        cursor: editing ? 'text' : dragOffset ? 'grabbing' : 'grab',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(note.content);
        setEditing(true);
      }}
    >
      <button
        type="button"
        aria-label="Delete note"
        className={cn(
          'absolute right-1 top-1 rounded-[3px] p-1 text-text-faint opacity-0',
          'transition-opacity duration-fast hover:bg-hover hover:text-status-error',
          'group-hover:opacity-100',
        )}
        onClick={(e) => {
          e.stopPropagation();
          removeStickyNote(note.id);
          void ipcStickyNoteDelete(note.id).catch((err) => {
            console.warn('failed to delete sticky note', err);
          });
        }}
      >
        <XIcon className="h-3 w-3" />
      </button>
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            persistContent(draft);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(note.content);
              setEditing(false);
              e.stopPropagation();
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              persistContent(draft);
              setEditing(false);
            }
          }}
          className={cn(
            'w-full resize-none bg-transparent px-3 py-2 text-12 text-text-primary',
            'placeholder:text-text-faint focus:outline-none',
          )}
          style={{ minHeight: NOTE_MIN_HEIGHT }}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words px-3 py-2 text-12 text-text-primary">
          {note.content || <span className="text-text-faint">double-click to edit</span>}
        </p>
      )}
    </div>
  );
}
