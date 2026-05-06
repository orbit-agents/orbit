import { useReactFlow } from '@xyflow/react';
import { useAgentsStore } from '@/stores/agents';

/**
 * SVG overlay rendered above the canvas that animates inter-agent
 * messages currently in flight. One arc per message, drawn from the
 * sender's node center to the recipient's node center. The arc fades
 * once the broker marks the message `acknowledged` (recipient finished
 * their turn) and the row is dropped from the in-flight map.
 *
 * Per ADR 0004, React Flow stays node-only — flight animations live
 * here as a separate overlay.
 */
export function MessageFlightLayer(): JSX.Element | null {
  const flow = useReactFlow();
  const flight = useAgentsStore((s) => s.inFlightMessages);
  const agents = useAgentsStore((s) => s.agents);

  const ids = Object.keys(flight);
  if (ids.length === 0) return null;

  const arcs = ids
    .map((id) => {
      const m = flight[id];
      if (!m) return null;
      const from = agents[m.fromAgentId];
      const to = agents[m.toAgentId];
      if (!from || !to) return null;

      // Convert canvas coordinates to screen pixels via React Flow's
      // viewport transform. Agent node centers sit at (positionX + 88,
      // positionY + 36) — half the 176×72 footprint from the V1
      // Ledger spec.
      const NODE_HALF_W = 88;
      const NODE_HALF_H = 36;
      const a = flow.flowToScreenPosition({
        x: from.positionX + NODE_HALF_W,
        y: from.positionY + NODE_HALF_H,
      });
      const b = flow.flowToScreenPosition({
        x: to.positionX + NODE_HALF_W,
        y: to.positionY + NODE_HALF_H,
      });

      // Curve control point: perpendicular offset from the midpoint so
      // the arc bulges; sign alternates with id-hash so concurrent
      // messages between the same pair don't overlap.
      const midx = (a.x + b.x) / 2;
      const midy = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.max(40, Math.sqrt(dx * dx + dy * dy));
      // Hash id to a sign so multiple in-flight messages between the
      // same pair don't render on top of each other.
      let hash = 0;
      for (let i = 0; i < m.id.length; i++) hash = (hash * 31 + m.id.charCodeAt(i)) | 0;
      const sign = hash % 2 === 0 ? 1 : -1;
      const offset = sign * Math.min(120, len * 0.25);
      const nx = -dy / len;
      const ny = dx / len;
      const cx = midx + nx * offset;
      const cy = midy + ny * offset;

      return { id: m.id, a, b, cx, cy, status: m.status };
    })
    .filter(
      (
        x,
      ): x is {
        id: string;
        a: { x: number; y: number };
        b: { x: number; y: number };
        cx: number;
        cy: number;
        status: string;
      } => x !== null,
    );

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ zIndex: 5 }}
    >
      <defs>
        <marker
          id="orbit-flight-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerUnits="strokeWidth"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--status-running)" />
        </marker>
      </defs>
      {arcs.map((arc) => {
        const d = `M ${arc.a.x} ${arc.a.y} Q ${arc.cx} ${arc.cy} ${arc.b.x} ${arc.b.y}`;
        const pending = arc.status === 'pending';
        return (
          <g key={arc.id}>
            <path
              d={d}
              fill="none"
              stroke="var(--status-running)"
              strokeOpacity={pending ? 0.55 : 0.75}
              strokeWidth={1.25}
              strokeDasharray="4 4"
              strokeLinecap="round"
              markerEnd="url(#orbit-flight-arrow)"
              style={{
                animation: 'orbit-flight-flow 1.4s linear infinite',
              }}
            />
          </g>
        );
      })}
    </svg>
  );
}
