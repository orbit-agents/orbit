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

  // Phase 3 — agent identity.
  soul: string | null;
  purpose: string | null;
  /**
   * 0 = the running agent's session has the latest soul/purpose/memory
   * already; 1 = the next user turn will carry a `<system_update>`
   * block with the latest values. The frontend mirrors this as a
   * boolean via `agent:identity_updated` events.
   */
  identityDirty: number;

  // Phase 5 — JSON-encoded array of absolute paths. `"[]"` in Phase 1.
  folderAccess: string;
  teamId: string | null;

  // Phase 2 — canvas position, always present (default 0,0 for
  // agents spawned before the canvas shipped; backfilled by migration
  // 0002 and enforced at the application layer thereafter).
  positionX: number;
  positionY: number;

  // Phase 6 — git isolation. `hasWorktree = 0` means the agent works
  // directly inside `workingDir` (Phase 1 behavior, no branch).
  // `hasWorktree = 1` means `workingDir` IS the worktree path and the
  // four `worktree*` fields are populated.
  hasWorktree: number;
  worktreePath: string | null;
  worktreeBranch: string | null;
  worktreeSourceRepo: string | null;
  worktreeBaseRef: string | null;

  createdAt: string;
  updatedAt: string;
}
