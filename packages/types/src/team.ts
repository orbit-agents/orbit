/**
 * Phase 5: visual grouping of agents on the canvas. Bounds are derived
 * from member positions at render time — see ADR 0007. The optional
 * `hint*` fields let an empty team carry a placeholder rectangle.
 */
export interface Team {
  id: string;
  name: string;
  color: string;
  hintX: number | null;
  hintY: number | null;
  hintWidth: number | null;
  hintHeight: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Bounding box defining a team's region on the canvas (computed). */
export interface RegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
