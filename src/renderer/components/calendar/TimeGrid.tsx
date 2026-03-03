import { formatTime } from '@/lib/date-utils';

const HOUR_HEIGHT = 60; // px per hour
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export const HOUR_HEIGHT_PX = HOUR_HEIGHT;
export const TOTAL_HEIGHT = HOUR_HEIGHT * 24;

export default function TimeGrid() {
  return (
    <div className="relative" style={{ height: TOTAL_HEIGHT }}>
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="absolute w-full border-t border-border/50"
          style={{ top: hour * HOUR_HEIGHT }}
        >
          <span className="absolute -top-2.5 left-2 text-[10px] text-muted-foreground leading-none select-none">
            {hour === 0 ? '' : formatTime(hour)}
          </span>
        </div>
      ))}
    </div>
  );
}
