import { create } from 'zustand';

// Global, shell-level state for the live deployment monitor popup — deliberately outside React tree
// position (DeploymentModal.tsx and DashboardShell.tsx's deployments list both trigger deploys/
// destroys from different components), so whichever one starts a run can make the popup appear
// without threading callback props through either.
type DeploymentMonitorState = {
  activeDeploymentId?: string;
  isOpen: boolean;
  isMinimized: boolean;
  position?: { x: number; y: number };
  watchDeployment: (id: string) => void;
  minimize: () => void;
  restore: () => void;
  close: () => void;
  setPosition: (position: { x: number; y: number }) => void;
};

export const useDeploymentMonitorStore = create<DeploymentMonitorState>()((set) => ({
  activeDeploymentId: undefined,
  isOpen: false,
  isMinimized: false,
  position: undefined,
  watchDeployment: (id) => set({ activeDeploymentId: id, isOpen: true, isMinimized: false }),
  minimize: () => set({ isMinimized: true }),
  restore: () => set({ isMinimized: false }),
  close: () => set({ isOpen: false, isMinimized: false, activeDeploymentId: undefined }),
  setPosition: (position) => set({ position }),
}));
