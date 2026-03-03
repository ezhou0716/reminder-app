import { useCalendarStore } from '@/stores/calendar-store';

export function useCalendarNavigation() {
  const { currentDate, weekStart, weekEnd, goToToday, goNextWeek, goPrevWeek } =
    useCalendarStore();

  return { currentDate, weekStart, weekEnd, goToToday, goNextWeek, goPrevWeek };
}
