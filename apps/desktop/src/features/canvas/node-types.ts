import type { NodeTypes } from '@xyflow/react';
import { AgentNode } from './nodes/agent-node';

/**
 * Registry of custom React Flow node types for the Orbit canvas.
 *
 * Phase 2 ships only `agentNode`. Future phases will add:
 *   - `teamNode` (Phase 5) for team region groupings
 *   - `stickyNote` (Phase 7) for human annotations
 *
 * Keep this export stable — React Flow requires the reference to be
 * referentially equal across renders or it will re-instantiate nodes.
 */
export const nodeTypes: NodeTypes = {
  agentNode: AgentNode,
};
