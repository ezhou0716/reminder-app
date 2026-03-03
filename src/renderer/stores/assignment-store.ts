import { create } from 'zustand';
import type { Assignment } from '@shared/types/assignment';

interface AssignmentState {
  assignments: Assignment[];
  loading: boolean;
  lastChecked: Date | null;
  setAssignments: (assignments: Assignment[]) => void;
  setLoading: (loading: boolean) => void;
  refresh: () => Promise<void>;
  toggleCompleted: (id: string, source: string) => Promise<void>;
}

export const useAssignmentStore = create<AssignmentState>((set, get) => ({
  assignments: [],
  loading: false,
  lastChecked: null,

  setAssignments: (assignments) =>
    set({ assignments, lastChecked: new Date(), loading: false }),

  setLoading: (loading) => set({ loading }),

  refresh: async () => {
    set({ loading: true });
    try {
      const assignments = await window.electronAPI.refreshAssignments();
      set({ assignments, lastChecked: new Date(), loading: false });
    } catch (err) {
      console.error('Failed to refresh assignments:', err);
      set({ loading: false });
    }
  },

  toggleCompleted: async (id, source) => {
    try {
      // IPC handler updates the cache and pushes via assignments:updated,
      // which the useAssignments hook picks up automatically
      await window.electronAPI.toggleCompleted(id, source);
    } catch (err) {
      console.error('Failed to toggle completed:', err);
    }
  },
}));
