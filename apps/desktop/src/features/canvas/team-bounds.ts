import type { Agent, Team } from '@orbit/types';

const PADDING = 16;
const NODE_WIDTH = 176;
const NODE_HEIGHT = 72;
const EMPTY_DEFAULT_W = 240;
const EMPTY_DEFAULT_H = 120;
/** Per the V1 Ledger spec we leave room above the topmost member for
 *  the mono-uppercase team label. */
const LABEL_HEADROOM = 8;

export interface TeamRegion {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  memberCount: number;
}

/**
 * Build the canvas-coordinate regions for every team. Members are
 * sourced from `agents.teamId`; bounds are derived from member
 * positions (+ 16px padding + 8px label headroom). Empty teams fall
 * back to the team's `hint*` placeholder, or a default 240×120 box
 * near the origin.
 */
export function buildTeamRegions(
  orderedTeamIds: readonly string[],
  teams: Record<string, Team>,
  agents: Record<string, Agent>,
): TeamRegion[] {
  const membersByTeam: Record<string, { x: number; y: number }[]> = {};
  for (const id of Object.keys(agents)) {
    const a = agents[id]!;
    if (!a.teamId) continue;
    const list = membersByTeam[a.teamId] ?? (membersByTeam[a.teamId] = []);
    list.push({ x: a.positionX, y: a.positionY });
  }

  return orderedTeamIds
    .map<TeamRegion | null>((id) => {
      const team = teams[id];
      if (!team) return null;
      const members = membersByTeam[id] ?? [];
      let x: number;
      let y: number;
      let width: number;
      let height: number;
      if (members.length > 0) {
        const xs = members.map((m) => m.x);
        const ys = members.map((m) => m.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs) + NODE_WIDTH;
        const maxY = Math.max(...ys) + NODE_HEIGHT;
        x = minX - PADDING;
        y = minY - PADDING - LABEL_HEADROOM;
        width = maxX - minX + PADDING * 2;
        height = maxY - minY + PADDING * 2 + LABEL_HEADROOM;
      } else {
        x = team.hintX ?? 24;
        y = team.hintY ?? 24;
        width = team.hintWidth ?? EMPTY_DEFAULT_W;
        height = team.hintHeight ?? EMPTY_DEFAULT_H;
      }
      return {
        id,
        name: team.name,
        color: team.color,
        x,
        y,
        width,
        height,
        memberCount: members.length,
      };
    })
    .filter((r): r is TeamRegion => r !== null);
}

/**
 * Return the team whose region contains the canvas-coordinate point,
 * or null. The point should be the dragged agent's *center* (top-left
 * + half node footprint) so single-agent drops still land cleanly.
 *
 * If multiple regions overlap (rare; only when teams visibly nest),
 * the smallest enclosing region wins so users can drop into a nested
 * sub-team without the parent eating the click.
 */
export function findTeamAtPoint(
  regions: readonly TeamRegion[],
  point: { x: number; y: number },
): TeamRegion | null {
  let best: TeamRegion | null = null;
  let bestArea = Infinity;
  for (const r of regions) {
    if (point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height) {
      const area = r.width * r.height;
      if (area < bestArea) {
        best = r;
        bestArea = area;
      }
    }
  }
  return best;
}

/** Half the node footprint so we can convert a node's top-left
 *  position to its center. */
export const NODE_CENTER_OFFSET = { x: NODE_WIDTH / 2, y: NODE_HEIGHT / 2 };
