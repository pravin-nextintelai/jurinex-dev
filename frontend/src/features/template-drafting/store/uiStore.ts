/**
 * Template Drafting Component - UI Store
 * Zustand store for UI state management
 */

import { create } from 'zustand';

type ActivePanel = 'form' | 'chat';

interface UiState {
    // Panel state
    activeRightPanel: ActivePanel;
    isLeftPanelCollapsed: boolean;
    rightPanelWidth: number;

    // Page navigation
    currentPageNo: number;
    totalPages: number;

    // Modal states
    isPreviewModalOpen: boolean;
    isExportDialogOpen: boolean;
    isVersionHistoryOpen: boolean;

    // Zoom state
    zoomLevel: number;

    // Actions
    setActiveRightPanel: (panel: ActivePanel) => void;
    toggleLeftPanel: () => void;
    setRightPanelWidth: (width: number) => void;
    setCurrentPage: (pageNo: number) => void;
    setTotalPages: (count: number) => void;
    openPreviewModal: () => void;
    closePreviewModal: () => void;
    openExportDialog: () => void;
    closeExportDialog: () => void;
    openVersionHistory: () => void;
    closeVersionHistory: () => void;
    setZoomLevel: (level: number) => void;
    zoomIn: () => void;
    zoomOut: () => void;
    reset: () => void;
}

const initialState = {
    activeRightPanel: 'form' as ActivePanel,
    isLeftPanelCollapsed: false,
    rightPanelWidth: 400,
    currentPageNo: 1,
    totalPages: 0,
    isPreviewModalOpen: false,
    isExportDialogOpen: false,
    isVersionHistoryOpen: false,
    zoomLevel: 1.0
};

export const useUiStore = create<UiState>((set) => ({
    ...initialState,

    setActiveRightPanel: (panel: ActivePanel) => {
        set({ activeRightPanel: panel });
    },

    toggleLeftPanel: () => {
        set((state: UiState) => ({ isLeftPanelCollapsed: !state.isLeftPanelCollapsed }));
    },

    setRightPanelWidth: (width: number) => {
        // Clamp between 300 and 600px
        const clampedWidth = Math.max(300, Math.min(600, width));
        set({ rightPanelWidth: clampedWidth });
    },

    setCurrentPage: (pageNo: number) => {
        set({ currentPageNo: pageNo });
    },

    setTotalPages: (count: number) => {
        set({ totalPages: count });
    },

    openPreviewModal: () => {
        set({ isPreviewModalOpen: true });
    },

    closePreviewModal: () => {
        set({ isPreviewModalOpen: false });
    },

    openExportDialog: () => {
        set({ isExportDialogOpen: true });
    },

    closeExportDialog: () => {
        set({ isExportDialogOpen: false });
    },

    openVersionHistory: () => {
        set({ isVersionHistoryOpen: true });
    },

    closeVersionHistory: () => {
        set({ isVersionHistoryOpen: false });
    },

    setZoomLevel: (level: number) => {
        set({ zoomLevel: Math.max(0.5, Math.min(2.0, level)) });
    },

    zoomIn: () => {
        set((state) => ({ zoomLevel: Math.min(2.0, state.zoomLevel + 0.1) }));
    },

    zoomOut: () => {
        set((state) => ({ zoomLevel: Math.max(0.5, state.zoomLevel - 0.1) }));
    },

    reset: () => {
        set(initialState);
    }
}));
