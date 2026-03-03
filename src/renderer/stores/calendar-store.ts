import { create } from 'zustand';
import { addWeeks, subWeeks, startOfWeek, endOfWeek } from 'date-fns';

type ViewMode = 'week' | 'assignments';

interface CalendarState {
  currentDate: Date;
  viewMode: ViewMode;
  weekStart: Date;
  weekEnd: Date;
  setViewMode: (mode: ViewMode) => void;
  goToToday: () => void;
  goNextWeek: () => void;
  goPrevWeek: () => void;
}

function computeWeekBounds(date: Date) {
  return {
    weekStart: startOfWeek(date, { weekStartsOn: 0 }),
    weekEnd: endOfWeek(date, { weekStartsOn: 0 }),
  };
}

export const useCalendarStore = create<CalendarState>((set) => {
  const now = new Date();
  const { weekStart, weekEnd } = computeWeekBounds(now);

  return {
    currentDate: now,
    viewMode: 'week',
    weekStart,
    weekEnd,

    setViewMode: (mode) => set({ viewMode: mode }),

    goToToday: () => {
      const today = new Date();
      const bounds = computeWeekBounds(today);
      set({ currentDate: today, ...bounds });
    },

    goNextWeek: () =>
      set((state) => {
        const next = addWeeks(state.currentDate, 1);
        return { currentDate: next, ...computeWeekBounds(next) };
      }),

    goPrevWeek: () =>
      set((state) => {
        const prev = subWeeks(state.currentDate, 1);
        return { currentDate: prev, ...computeWeekBounds(prev) };
      }),
  };
});
