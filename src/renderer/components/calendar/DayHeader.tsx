import { isToday } from 'date-fns';
import { formatDayHeader } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

interface DayHeaderProps {
  day: Date;
}

export default function DayHeader({ day }: DayHeaderProps) {
  const { dayName, dayNumber } = formatDayHeader(day);
  const today = isToday(day);

  return (
    <div className="text-center py-2 border-b border-border">
      <div className={cn('text-xs uppercase tracking-wider', today ? 'text-berkeley-blue' : 'text-muted-foreground')}>
        {dayName}
      </div>
      <div
        className={cn(
          'text-xl font-semibold mt-0.5 w-9 h-9 flex items-center justify-center mx-auto rounded-full',
          today ? 'bg-berkeley-blue text-white' : 'text-foreground',
        )}
      >
        {dayNumber}
      </div>
    </div>
  );
}
