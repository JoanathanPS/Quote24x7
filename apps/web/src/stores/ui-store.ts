import { create } from "zustand";
import type { ThreadStatus } from "@/types/domain";

interface ThreadFilters {
  status?: ThreadStatus;
  search?: string;
}

interface UIState {
  // Sidebar
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  // Thread list filters
  threadFilters: ThreadFilters;
  setThreadFilters: (filters: Partial<ThreadFilters>) => void;
  resetThreadFilters: () => void;

  // Selected quote option tab
  selectedOptionId: string | null;
  setSelectedOptionId: (id: string | null) => void;
}

const INITIAL_FILTERS: ThreadFilters = {};

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  threadFilters: INITIAL_FILTERS,
  setThreadFilters: (filters) =>
    set((s) => ({ threadFilters: { ...s.threadFilters, ...filters } })),
  resetThreadFilters: () => set({ threadFilters: INITIAL_FILTERS }),

  selectedOptionId: null,
  setSelectedOptionId: (id) => set({ selectedOptionId: id }),
}));
