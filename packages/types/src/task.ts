/**
 * Phase 7: per-agent task. Created either by the agent (via the
 * `<task>` pseudo-tool, ADR 0009) or by the human (Tasks accordion +
 * Task Inbox). Both surfaces mutate the same row.
 */
export type TaskStatus = 'queued' | 'running' | 'awaiting_human' | 'blocked' | 'done' | 'failed';

export type TaskPriority = 'low' | 'normal' | 'high';

export interface Task {
  id: string;
  agentId: string;
  title: string;
  description: string | null;
  /** String on the wire so a future status doesn't break older databases. */
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
