import { useEffect, useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useAgentsStore } from '@/stores/agents';
import { buildTeamRegions } from './team-bounds';

/**
 * V1 Ledger team-region overlay. One dashed rounded rectangle per
 * team, drawn underneath the agent nodes. Bounds derived in
 * `team-bounds.ts` (members + 16px padding + 8px label headroom).
 * See ADR 0007.
 */
const FOCUS_PADDING = 0.25;

export function TeamRegionLayer(): JSX.Element | null {
  const flow = useReactFlow();
  const orderedTeamIds = useAgentsStore((s) => s.orderedTeamIds);
  const teams = useAgentsStore((s) => s.teams);
  const agents = useAgentsStore((s) => s.agents);
  const focusedTeamId = useAgentsStore((s) => s.focusedTeamId);
  const focusTeam = useAgentsStore((s) => s.focusTeam);

  const regions = useMemo(
    () => buildTeamRegions(orderedTeamIds, teams, agents),
    [orderedTeamIds, teams, agents],
  );

  // When a team is focused (e.g. clicked in the sidebar), fit the
  // canvas viewport to that team's bounds. Clear `focusedTeamId`
  // afterwards so re-focusing the same team re-pans.
  useEffect(() => {
    if (!focusedTeamId) return;
    const region = regions.find((r) => r.id === focusedTeamId);
    if (!region) {
      focusTeam(null);
      return;
    }
    void flow.fitBounds(
      { x: region.x, y: region.y, width: region.width, height: region.height },
      { duration: 320, padding: FOCUS_PADDING },
    );
    focusTeam(null);
  }, [focusedTeamId, regions, flow, focusTeam]);

  if (regions.length === 0) return null;

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ zIndex: 1 }}
    >
      {regions.map((region) => {
        const a = flow.flowToScreenPosition({ x: region.x, y: region.y });
        const b = flow.flowToScreenPosition({
          x: region.x + region.width,
          y: region.y + region.height,
        });
        const left = Math.min(a.x, b.x);
        const top = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        return (
          <g key={region.id}>
            <rect
              x={left}
              y={top}
              width={w}
              height={h}
              rx={6}
              ry={6}
              fill={region.color}
              fillOpacity={0.06}
              stroke="var(--line2)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text
              x={left + 10}
              y={top + 16}
              fontFamily="JetBrains Mono, ui-monospace, monospace"
              fontSize={10}
              fontWeight={600}
              letterSpacing={1.4}
              fill="var(--color-text-faint)"
              style={{ textTransform: 'uppercase' }}
            >
              {region.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
