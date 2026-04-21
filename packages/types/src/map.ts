import type { Agent } from './agent.js';
import type { Folder } from './folder.js';
import type { Team } from './team.js';

export interface Map {
  id: string;
  name: string;
  folders: readonly Folder[];
  agents: readonly Agent[];
  teams: readonly Team[];
  createdAt: string;
}
