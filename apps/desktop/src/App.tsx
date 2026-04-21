import { useCallback } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { TopBar } from '@/components/layout/TopBar';
import { Sidebar } from '@/components/layout/Sidebar';
import { CanvasPlaceholder } from '@/components/layout/CanvasPlaceholder';
import { RightPanel } from '@/components/layout/RightPanel';
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut';
import { useUiStore } from '@/stores/ui-store';
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

  return (
    <div className="flex h-full w-full flex-col bg-app text-text-primary">
      <TopBar />
      <PanelGroup direction="horizontal" className="flex-1">
        {sidebarOpen ? (
          <>
            <Panel defaultSize={18} minSize={14} maxSize={26} className="min-w-[260px]">
              <Sidebar />
            </Panel>
            <ResizeHandle />
          </>
        ) : null}

        <Panel defaultSize={rightPanelOpen ? 58 : 82} minSize={30}>
          {canvasOpen ? (
            <CanvasPlaceholder />
          ) : (
            <div className="flex h-full items-center justify-center bg-app text-13 text-text-tertiary">
              canvas hidden — Cmd/Ctrl+E to show
            </div>
          )}
        </Panel>

        {rightPanelOpen ? (
          <>
            <ResizeHandle />
            <Panel defaultSize={24} minSize={18} maxSize={34} className="min-w-[360px]">
              <RightPanel />
            </Panel>
          </>
        ) : null}
      </PanelGroup>
    </div>
  );
}
