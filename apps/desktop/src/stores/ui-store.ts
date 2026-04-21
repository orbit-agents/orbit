import { create } from 'zustand';

interface UiState {
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  canvasOpen: boolean;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  toggleCanvas: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  rightPanelOpen: true,
  canvasOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleCanvas: () => set((s) => ({ canvasOpen: !s.canvasOpen })),
}));
