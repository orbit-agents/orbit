import { create } from 'zustand';

export type RightPanelTab = 'chat' | 'settings' | 'diff';

interface UiState {
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  canvasOpen: boolean;
  rightPanelTab: RightPanelTab;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  toggleCanvas: () => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  /** Open the right panel and switch to a specific tab in one call. */
  openRightPanelTab: (tab: RightPanelTab) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  rightPanelOpen: true,
  canvasOpen: true,
  rightPanelTab: 'chat',
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleCanvas: () => set((s) => ({ canvasOpen: !s.canvasOpen })),
  setRightPanelTab: (tab) => set(() => ({ rightPanelTab: tab })),
  openRightPanelTab: (tab) => set(() => ({ rightPanelOpen: true, rightPanelTab: tab })),
}));
