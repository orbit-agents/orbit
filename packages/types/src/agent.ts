/** The status of an agent at a given moment. */
export type AgentStatus = 'idle' | 'active' | 'waiting_for_human' | 'error';

/** 2D canvas position, in logical pixels relative to the map's coordinate system. */
export interface Position {
  x: number;
  y: number;
}

/**
 * Soul / Purpose / Memory are injected into the agent's system prompt on every turn.
 * They are versioned fields on the agent record itself; history is tracked in the DB.
 */
export interface AgentIdentity {
  /** Personality, tone, quirks. Stable over the agent's life. */
  soul: string;
  /** What this agent is here to accomplish in the current context. May change. */
  purpose: string;
  /** Persistent notes the agent has written about itself or its work. */
  memory: string;
}

export interface Agent extends AgentIdentity {
  id: string;
  name: string;
  emoji: string;
  color: string;
  status: AgentStatus;
  /** Free-form text of what the agent is currently working on, for UI display. */
  currentTask: string | null;
  position: Position;
  /** Optional team grouping. Null = no team. */
  teamId: string | null;
  /** Absolute folder paths the agent is permitted to read/write. */
  folderAccess: readonly string[];
  /** Per-agent override of the default model (e.g. "claude-opus-4-7"). */
  modelOverride: string | null;
  createdAt: string;
  updatedAt: string;
}
