/** The status of an agent at a given moment. */
export type AgentStatus = 'idle' | 'active' | 'waiting_for_human' | 'error';

/** 2D canvas position — reserved for Phase 2. */
export interface Position {
  x: number;
  y: number;
}

/**
 * Serialized shape from the Rust `Agent` struct. Field names match the
 * camelCase serde output. Fields reserved for later phases are present
 * but may be `null` in Phase 1.
 */
export interface Agent {
  id: string;
  name: string;
  emoji: string;
  color: string;
  workingDir: string;
  sessionId: string | null;
  modelOverride: string | null;
  status: string;

  // Phase 3 — agent identity. Null in Phase 1.
  soul: string | null;
  purpose: string | null;
  memory: string | null;

  // Phase 5 — JSON-encoded array of absolute paths. `"[]"` in Phase 1.
  folderAccess: string;
  teamId: string | null;

  // Phase 2 — canvas position, always present (default 0,0 for
  // agents spawned before the canvas shipped; backfilled by migration
  // 0002 and enforced at the application layer thereafter).
  positionX: number;
  positionY: number;

  createdAt: string;
  updatedAt: string;
}
