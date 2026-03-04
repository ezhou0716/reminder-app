import { create } from 'zustand';
import type { Assignment } from '@shared/types/assignment';

interface AssignmentState {
  assignments: Assignment[];
  loading: boolean;
  lastChecked: Date | null;
  pendingCalendarOps: Set<string>;
  setAssignments: (assignments: Assignment[]) => void;
  setLoading: (loading: boolean) => void;
  refresh: () => Promise<void>;
  toggleCompleted: (id: string, source: string) => Promise<void>;
  removeFromCalendar: (id: string, source: string) => Promise<void>;
  addToCalendar: (id: string, source: string) => Promise<void>;
}

export const useAssignmentStore = create<AssignmentState>((set, get) => ({
  assignments: [],
  loading: false,
  lastChecked: null,
  pendingCalendarOps: new Set<string>(),

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
      await window.electronAPI.toggleCompleted(id, source);
    } catch (err) {
      console.error('Failed to toggle completed:', err);
    }
  },

  removeFromCalendar: async (id, source) => {
    const key = `${source}-${id}`;
    if (get().pendingCalendarOps.has(key)) return;
    const pending = new Set(get().pendingCalendarOps);
    pending.add(key);
    set({ pendingCalendarOps: pending });
    try {
      await window.electronAPI.removeAssignmentFromCalendar(id, source);
    } catch (err) {
      console.error('Failed to remove from calendar:', err);
    } finally {
      const updated = new Set(get().pendingCalendarOps);
      updated.delete(key);
      set({ pendingCalendarOps: updated });
    }
  },

  addToCalendar: async (id, source) => {
    const key = `${source}-${id}`;
    if (get().pendingCalendarOps.has(key)) return;
    const pending = new Set(get().pendingCalendarOps);
    pending.add(key);
    set({ pendingCalendarOps: pending });
    try {
      await window.electronAPI.addAssignmentToCalendar(id, source);
    } catch (err) {
      console.error('Failed to add to calendar:', err);
    } finally {
      const updated = new Set(get().pendingCalendarOps);
      updated.delete(key);
      set({ pendingCalendarOps: updated });
    }
  },
}));
