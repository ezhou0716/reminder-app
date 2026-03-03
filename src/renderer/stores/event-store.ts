import { create } from 'zustand';
import type { CalendarEvent, CalendarEventInput } from '@shared/types/event';

interface EventState {
  events: CalendarEvent[];
  loading: boolean;
  syncing: boolean;
  syncError: string | null;
  setEvents: (events: CalendarEvent[]) => void;
  setLoading: (loading: boolean) => void;
  setSyncing: (syncing: boolean, error?: string) => void;
  loadEvents: (startTime: string, endTime: string) => Promise<void>;
  createEvent: (input: CalendarEventInput) => Promise<CalendarEvent>;
  updateEvent: (id: string, input: Partial<CalendarEventInput>) => Promise<CalendarEvent>;
  deleteEvent: (id: string) => Promise<void>;
  syncGoogle: () => Promise<void>;
}

export const useEventStore = create<EventState>((set, get) => ({
  events: [],
  loading: false,
  syncing: false,
  syncError: null,

  setEvents: (events) => set({ events }),
  setLoading: (loading) => set({ loading }),
  setSyncing: (syncing, error) => set({ syncing, syncError: error ?? null }),

  loadEvents: async (startTime, endTime) => {
    set({ loading: true });
    try {
      const events = await window.electronAPI.getEvents(startTime, endTime);
      set({ events, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createEvent: async (input) => {
    const event = await window.electronAPI.createEvent(input);
    return event;
  },

  updateEvent: async (id, input) => {
    const event = await window.electronAPI.updateEvent(id, input);
    return event;
  },

  deleteEvent: async (id) => {
    await window.electronAPI.deleteEvent(id);
  },

  syncGoogle: async () => {
    set({ syncing: true, syncError: null });
    try {
      await window.electronAPI.syncGoogleCalendar();
      set({ syncing: false });
    } catch (err) {
      set({ syncing: false, syncError: String(err) });
    }
  },
}));
