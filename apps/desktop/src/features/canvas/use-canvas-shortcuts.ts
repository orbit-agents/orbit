import { useCallback, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { XY } from '@/stores/agents';
import { useAgentsStore } from '@/stores/agents';

/**
 * Keyboard shortcuts scoped to the canvas.
 *
 * - `Cmd/Ctrl+Shift+N` — open the spawn dialog centered on the current
 *   viewport.
 * - `Escape` — deselect and cancel any in-progress drag.
 */
export function useCanvasShortcuts(onRequestSpawn: (pos: XY | null) => void): void {
  const flow = useReactFlow();
  const selectAgent = useAgentsStore((s) => s.selectAgent);

  const centerViewportSpawn = useCallback(() => {
    // Place the new agent at the center of the current viewport in
    // flow coordinates. `fromViewport` helpers aren't needed here;
    // React Flow gives us the inverse mapping directly.
    const vp = flow.getViewport();
    const center = flow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    void vp;
    onRequestSpawn({ x: Math.round(center.x / 20) * 20, y: Math.round(center.y / 20) * 20 });
  }, [flow, onRequestSpawn]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        centerViewportSpawn();
        return;
      }
      if (e.key === 'Escape') {
        selectAgent(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [centerViewportSpawn, selectAgent]);
}
