import { useCallback, useEffect, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useQuery } from '@tanstack/react-query';
import { TopBar } from '@/components/layout/TopBar';
import { Sidebar } from '@/components/layout/Sidebar';
import { CanvasPlaceholder } from '@/components/layout/CanvasPlaceholder';
import { AgentList } from '@/features/agents/agent-list';
import { SpawnAgentDialog } from '@/features/agents/spawn-agent-dialog';
import { AgentDetailPanel } from '@/features/agents/agent-detail-panel';
import { SystemHealthSetupView } from '@/features/agents/system-health-banner';
import { Canvas } from '@/features/canvas/canvas';
import { TaskInbox } from '@/features/tasks/task-inbox';
import type { XY } from '@/stores/agents';
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut';
import { useAgentEvents } from '@/hooks/use-agent-events';
import { useUiStore } from '@/stores/ui-store';
import { useAgentsStore } from '@/stores/agents';
import { ipcAgentList, ipcStickyNoteList, ipcSystemHealthCheck, ipcTeamList } from '@/lib/ipc';
import { cn } from '@/lib/cn';

function ResizeHandle(): JSX.Element {
  return (
    <PanelResizeHandle
      className={cn(
        'relative w-px bg-border-subtle transition-colors duration-fast',
        'hover:bg-border data-[resize-handle-active]:bg-accent',
      )}
    />
  );
}

export function App(): JSX.Element {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  const canvasOpen = useUiStore((s) => s.canvasOpen);
  const centerView = useUiStore((s) => s.centerView);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);
  const toggleCanvas = useUiStore((s) => s.toggleCanvas);

  useKeyboardShortcut(
    { key: 'b', modKey: true },
    useCallback(() => toggleSidebar(), [toggleSidebar]),
  );
  useKeyboardShortcut(
    { key: 'j', modKey: true },
    useCallback(() => toggleRightPanel(), [toggleRightPanel]),
  );
  useKeyboardShortcut(
    { key: 'e', modKey: true },
    useCallback(() => toggleCanvas(), [toggleCanvas]),
  );

  const hydrate = useAgentsStore((s) => s.hydrate);
  const hydrateTeams = useAgentsStore((s) => s.hydrateTeams);
  const hydrateStickyNotes = useAgentsStore((s) => s.hydrateStickyNotes);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [spawnPosition, setSpawnPosition] = useState<XY | null>(null);

  const openSpawnDialog = useCallback((position: XY | null) => {
    setSpawnPosition(position);
    setSpawnOpen(true);
  }, []);

  useAgentEvents();

  const health = useQuery({
    queryKey: ['system-health'],
    queryFn: ipcSystemHealthCheck,
    retry: false,
  });

  useQuery({
    queryKey: ['agents'],
    enabled: Boolean(health.data?.engine.available && health.data?.engine.authenticated),
    queryFn: async () => {
      const agents = await ipcAgentList();
      hydrate(agents);
      return agents;
    },
  });

  useQuery({
    queryKey: ['teams'],
    enabled: Boolean(health.data?.engine.available && health.data?.engine.authenticated),
    queryFn: async () => {
      const teams = await ipcTeamList();
      hydrateTeams(teams);
      return teams;
    },
  });

  useQuery({
    queryKey: ['sticky-notes'],
    enabled: Boolean(health.data?.engine.available && health.data?.engine.authenticated),
    queryFn: async () => {
      const notes = await ipcStickyNoteList();
      hydrateStickyNotes(notes);
      return notes;
    },
  });

  const engine = health.data?.engine ?? null;
  const blockedOnSetup = health.isSuccess && (!engine?.available || !engine?.authenticated);

  useEffect(() => {
    if (health.isError) {
      const id = setInterval(() => void health.refetch(), 4000);
      return () => clearInterval(id);
    }
    return;
  }, [health]);

  if (health.isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-app text-13 text-text-tertiary">
        Loading…
      </div>
    );
  }

  if (blockedOnSetup) {
    return (
      <SystemHealthSetupView health={health.data ?? null} onRecheck={() => void health.refetch()} />
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-app text-text-primary">
      <TopBar />
      <PanelGroup direction="horizontal" className="flex-1">
        {sidebarOpen ? (
          <>
            <Panel defaultSize={18} minSize={14} maxSize={26} className="min-w-[260px]">
              <div className="flex h-full flex-col bg-panel">
                <Sidebar />
                <AgentList onSpawnClick={() => openSpawnDialog(null)} />
              </div>
            </Panel>
            <ResizeHandle />
          </>
        ) : null}

        <Panel defaultSize={rightPanelOpen ? 58 : 82} minSize={30}>
          {centerView === 'task-inbox' ? (
            <TaskInbox />
          ) : canvasOpen ? (
            <Canvas onRequestSpawn={openSpawnDialog} />
          ) : (
            <CanvasPlaceholder />
          )}
        </Panel>

        {rightPanelOpen ? (
          <>
            <ResizeHandle />
            <Panel defaultSize={24} minSize={18} maxSize={34} className="min-w-[360px]">
              <AgentDetailPanel />
            </Panel>
          </>
        ) : null}
      </PanelGroup>

      <SpawnAgentDialog
        open={spawnOpen}
        onClose={() => {
          setSpawnOpen(false);
          setSpawnPosition(null);
        }}
        position={spawnPosition}
      />
    </div>
  );
}
