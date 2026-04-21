/** Bounding box defining a team's visual region on the canvas. */
export interface RegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Team {
  id: string;
  name: string;
  color: string;
  emoji: string;
  agentIds: readonly string[];
  regionBounds: RegionBounds;
}
