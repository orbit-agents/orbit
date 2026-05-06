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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { useAgentsStore, deriveStatus, type XY } from '@/stores/agents';
import { useUiStore } from '@/stores/ui-store';
import { ipcAgentSetTeam, ipcAgentTerminate, ipcAgentUpdatePosition } from '@/lib/ipc';
import { buildTeamRegions, findTeamAtPoint, NODE_CENTER_OFFSET } from './team-bounds';
import type { Agent, Message } from '@orbit/types';
import { nodeTypes } from './node-types';
import type { AgentNodeData } from './nodes/agent-node';
import { EmptyCanvasPrompt } from './empty-canvas-prompt';
import { CanvasToolbar } from './canvas-toolbar';
import { AgentCountPill } from './agent-count-pill';
import { MessageFlightLayer } from './message-flight-layer';
import { TeamRegionLayer } from './team-region-layer';
import { useCanvasShortcuts } from './use-canvas-shortcuts';
import { AgentContextMenu, type AgentContextMenuAction } from './agent-context-menu';

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
  const teams = useAgentsStore((s) => s.teams);
  const orderedTeamIds = useAgentsStore((s) => s.orderedTeamIds);
  const setAgentTeam = useAgentsStore((s) => s.setAgentTeam);
  const allAgents = useAgentsStore((s) => s.agents);

  const flow = useReactFlow<Node<AgentNodeData>>();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const openRightPanelTab = useUiStore((s) => s.openRightPanelTab);
  const qc = useQueryClient();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    agentId: string;
  } | null>(null);

  const terminate = useMutation({
    mutationFn: (agentId: string) => ipcAgentTerminate(agentId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  useCanvasShortcuts(onRequestSpawn);

  // Smoothly pan the viewport to center on the selected agent when
  // selection changes from outside the canvas (sidebar click, keyboard
  // shortcut, etc.). We track the last selection we centered on so
  // clicking a node doesn't retrigger a jarring pan.
  const lastCenteredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedAgentId) {
      lastCenteredRef.current = null;
      return;
    }
    if (lastCenteredRef.current === selectedAgentId) return;
    const agent = agents.find((a) => a.id === selectedAgentId);
    if (!agent) return;
    lastCenteredRef.current = selectedAgentId;
    void flow.setCenter(agent.positionX, agent.positionY, {
      duration: 300,
      zoom: flow.getZoom(),
    });
  }, [selectedAgentId, agents, flow]);

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
        console.warn('failed to persist agent position', e);
      });

      // Phase 5: drag-into-team hit test. Compute regions excluding
      // this agent's contribution to avoid the trivial self-match,
      // then test the agent's *center* against the remaining regions.
      const others = { ...allAgents };
      const moved = others[node.id];
      if (moved) {
        // Use the post-snap position so the hit test matches what the
        // user actually sees on the next render.
        others[node.id] = { ...moved, positionX: sx, positionY: sy };
      }
      const regions = buildTeamRegions(orderedTeamIds, teams, others);
      const center = {
        x: sx + NODE_CENTER_OFFSET.x,
        y: sy + NODE_CENTER_OFFSET.y,
      };
      const hit = findTeamAtPoint(regions, center);
      const currentTeamId = moved?.teamId ?? null;
      const nextTeamId = hit?.id ?? null;
      if (nextTeamId !== currentTeamId) {
        setAgentTeam(node.id, nextTeamId);
        void ipcAgentSetTeam(node.id, nextTeamId).catch((e) => {
          console.warn('failed to persist team membership', e);
        });
      }
    },
    [updateAgentPosition, setDraggingAgent, allAgents, orderedTeamIds, teams, setAgentTeam],
  );

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_e, node) => {
      // Clicking an already-selected agent is a no-op (spec: clicking an
      // agent while it's already selected does not toggle off).
      if (selectedAgentId === node.id) return;
      selectAgent(node.id);
      // Suppress the pan-on-selection effect above — the agent is
      // already where the cursor is; no need to animate.
      lastCenteredRef.current = node.id;
    },
    [selectedAgentId, selectAgent],
  );

  const onNodeDoubleClick = useCallback<NodeMouseHandler>(
    (_e, node) => {
      selectAgent(node.id);
      lastCenteredRef.current = node.id;
      openRightPanelTab('settings');
    },
    [selectAgent, openRightPanelTab],
  );

  const onNodeContextMenu = useCallback<NodeMouseHandler>(
    (e, node) => {
      e.preventDefault();
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setContextMenu({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        agentId: node.id,
      });
      selectAgent(node.id);
      lastCenteredRef.current = node.id;
    },
    [selectAgent],
  );

  const handleContextMenuAction = useCallback(
    (action: AgentContextMenuAction['id']) => {
      const agentId = contextMenu?.agentId;
      if (!agentId) return;
      switch (action) {
        case 'focus-chat':
          selectAgent(agentId);
          openRightPanelTab('chat');
          break;
        case 'rename':
          selectAgent(agentId);
          openRightPanelTab('settings');
          break;
        case 'terminate':
          terminate.mutate(agentId);
          break;
      }
    },
    [contextMenu, selectAgent, openRightPanelTab, terminate],
  );

  const onPaneClick = useCallback(() => {
    // Deselect on empty-canvas click, unless nothing is selected — in
    // that case, we treat it as a deliberate empty click and still
    // clear the "last centered" bookkeeping.
    selectAgent(null);
  }, [selectAgent]);

  // Double-click empty canvas spawns an agent at the clicked position.
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
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
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
      <TeamRegionLayer />
      <MessageFlightLayer />
      <AgentCountPill />
      <CanvasToolbar />
      {contextMenu ? (
        <AgentContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onSelect={handleContextMenuAction}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
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
