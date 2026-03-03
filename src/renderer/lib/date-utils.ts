import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  isSameDay,
  isToday,
  eachDayOfInterval,
  differenceInHours,
  parseISO,
} from 'date-fns';

export function getWeekDays(date: Date): Date[] {
  const start = startOfWeek(date, { weekStartsOn: 0 }); // Sunday
  const end = endOfWeek(date, { weekStartsOn: 0 });
  return eachDayOfInterval({ start, end });
}

export function getWeekRange(date: Date): { start: Date; end: Date } {
  return {
    start: startOfWeek(date, { weekStartsOn: 0 }),
    end: endOfWeek(date, { weekStartsOn: 0 }),
  };
}

export function formatWeekRange(date: Date): string {
  const { start, end } = getWeekRange(date);
  if (start.getMonth() === end.getMonth()) {
    return `${format(start, 'MMM d')} – ${format(end, 'd, yyyy')}`;
  }
  return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
}

export function formatDayHeader(date: Date): { dayName: string; dayNumber: string } {
  return {
    dayName: format(date, 'EEE'),
    dayNumber: format(date, 'd'),
  };
}

export function formatTime(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

export function formatDueDate(isoString: string): string {
  const date = parseISO(isoString);
  return format(date, 'MMM d, h:mm a');
}

export function hoursUntil(isoString: string): number {
  return differenceInHours(parseISO(isoString), new Date());
}

export { isSameDay, isToday, addWeeks, subWeeks, parseISO };
