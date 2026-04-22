import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type OnNodesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cn } from '@/lib/cn';
import { useAgentsStore, deriveStatus, type XY } from '@/stores/agents';
import { ipcAgentUpdatePosition } from '@/lib/ipc';
import type { Agent, Message } from '@orbit/types';
import { nodeTypes } from './node-types';
import type { AgentNodeData } from './nodes/agent-node';
import { EmptyCanvasPrompt } from './empty-canvas-prompt';
import { CanvasToolbar } from './canvas-toolbar';
import { useCanvasShortcuts } from './use-canvas-shortcuts';

interface Props {
  onRequestSpawn: (position: XY | null) => void;
}

/** Snap value to the nearest grid step. */
function snap(v: number, step: number): number {
  return Math.round(v / step) * step;
}

const SNAP_STEP = 20;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.0;

function CanvasInner({ onRequestSpawn }: Props): JSX.Element {
  const agents = useAgentsStore(
    (s) => s.orderedAgentIds.map((id) => s.agents[id]).filter(Boolean) as Agent[],
  );
  const selectedAgentId = useAgentsStore((s) => s.selectedAgentId);
  const messagesByAgent = useAgentsStore((s) => s.messagesByAgent);
  const streamingByAgent = useAgentsStore((s) => s.streamingByAgent);
  const lastErrorByAgent = useAgentsStore((s) => s.lastErrorByAgent);
  const updateAgentPosition = useAgentsStore((s) => s.updateAgentPosition);
  const selectAgent = useAgentsStore((s) => s.selectAgent);
  const setDraggingAgent = useAgentsStore((s) => s.setDraggingAgent);

  const flow = useReactFlow<Node<AgentNodeData>>();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useCanvasShortcuts(onRequestSpawn);

  // Derive React Flow nodes from the store. Position is authoritative
  // from the store; React Flow never owns position state.
  const derivedNodes: Node<AgentNodeData>[] = useMemo(() => {
    return agents.map((a) => {
      const streaming = streamingByAgent[a.id] ?? null;
      const lastError = lastErrorByAgent[a.id] ?? null;
      const lastAssistantText = lastAssistantTextFor(messagesByAgent[a.id] ?? []);
      const status = deriveStatus(a, streaming, lastError, lastAssistantText);
      const currentTask = streaming
        ? truncate(streaming.text, 40)
        : a.status === 'error' && lastError
          ? `error: ${truncate(lastError, 30)}`
          : '';

      return {
        id: a.id,
        type: 'agentNode',
        position: { x: a.positionX, y: a.positionY },
        data: {
          agentId: a.id,
          name: a.name,
          emoji: a.emoji,
          color: a.color,
          currentTask,
          status,
          selected: a.id === selectedAgentId,
        },
        draggable: true,
        selectable: true,
        connectable: false,
      };
    });
  }, [agents, selectedAgentId, streamingByAgent, lastErrorByAgent, messagesByAgent]);

  const onNodesChange: OnNodesChange<Node<AgentNodeData>> = useCallback(
    (changes: NodeChange<Node<AgentNodeData>>[]) => {
      // React Flow handed us changes (position deltas from drag, etc.).
      // Apply them to a transient nodes array so we can read positions
      // back into the store without fighting React Flow's internal math.
      const next = applyNodeChanges(changes, derivedNodes);
      for (const n of next) {
        const original = derivedNodes.find((dn) => dn.id === n.id);
        if (!original) continue;
        if (original.position.x !== n.position.x || original.position.y !== n.position.y) {
          updateAgentPosition(n.id, { x: n.position.x, y: n.position.y });
        }
      }
    },
    [derivedNodes, updateAgentPosition],
  );

  const onNodeDragStart = useCallback<NodeMouseHandler>(
    (_e, node) => {
      setDraggingAgent(node.id);
    },
    [setDraggingAgent],
  );

  const onNodeDragStop = useCallback<NodeMouseHandler>(
    (_e, node) => {
      // Snap to grid on release for tidier layouts.
      const sx = snap(node.position.x, SNAP_STEP);
      const sy = snap(node.position.y, SNAP_STEP);
      if (sx !== node.position.x || sy !== node.position.y) {
        updateAgentPosition(node.id, { x: sx, y: sy });
      }
      setDraggingAgent(null);
      // Persist the final position to the DB.
      void ipcAgentUpdatePosition(node.id, sx, sy).catch((e) => {
        // Soft failure — the in-memory position is already correct; the
        // next drag or restart will retry.
        console.warn('failed to persist agent position', e);
      });
    },
    [updateAgentPosition, setDraggingAgent],
  );

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_e, node) => {
      selectAgent(node.id);
    },
    [selectAgent],
  );

  // Double-click routing is wired up in M8.
  const onPaneClick = useCallback(() => {
    // Deselect on empty-canvas click.
    selectAgent(null);
  }, [selectAgent]);

  // Spawn flow — M7. Clicking empty canvas with no agent selected
  // opens the spawn dialog at the clicked position.
  const onPaneDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const { x, y } = flow.screenToFlowPosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      onRequestSpawn({ x: snap(x, SNAP_STEP), y: snap(y, SNAP_STEP) });
    },
    [flow, onRequestSpawn],
  );

  const isEmpty = agents.length === 0;

  return (
    <div ref={containerRef} className={cn('relative h-full w-full bg-app')}>
      <ReactFlow
        nodes={derivedNodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onDoubleClick={onPaneDoubleClick}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        nodesConnectable={false}
        elementsSelectable
        multiSelectionKeyCode={null}
        selectionKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.2}
          color="var(--color-border-subtle)"
        />
      </ReactFlow>
      {isEmpty ? <EmptyCanvasPrompt /> : null}
      <CanvasToolbar />
    </div>
  );
}

export function Canvas(props: Props): JSX.Element {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
}

function lastAssistantTextFor(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (m.role !== 'assistant') continue;
    try {
      const parsed = JSON.parse(m.content) as { text?: unknown };
      if (typeof parsed.text === 'string') return parsed.text;
    } catch {
      return null;
    }
  }
  return null;
}

/** Re-export so lib/ipc.ts doesn't have to change for Phase 2. */
export {};
