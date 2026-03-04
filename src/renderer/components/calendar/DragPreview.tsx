import { HOUR_HEIGHT_PX } from './TimeGrid';

interface DragPreviewProps {
  title: string;
  color: string;
  startMinutes: number;
  endMinutes: number;
  dayIndex: number;
}

export default function DragPreview({ title, color, startMinutes, endMinutes, dayIndex }: DragPreviewProps) {
  const durationMinutes = Math.max(endMinutes - startMinutes, 15);
  const top = (startMinutes / 60) * HOUR_HEIGHT_PX;
  const height = Math.max((durationMinutes / 60) * HOUR_HEIGHT_PX, 15);

  // Position in the grid: skip the 60px time gutter, then place in the correct day column
  // The grid is: 60px + repeat(7, 1fr)
  // We use gridColumn to position within the parent grid
  return (
    <div
      className="absolute rounded-md px-1.5 py-0.5 text-[10px] overflow-hidden pointer-events-none z-30 border-2 border-dashed"
      style={{
        top,
        height,
        // Position within the day column using same grid math
        // dayIndex 0-6 maps to grid columns 2-8 (1-indexed, column 1 is time gutter)
        gridColumn: `${dayIndex + 2} / ${dayIndex + 3}`,
        left: 2,
        right: 2,
        backgroundColor: `${color}40`,
        borderColor: color,
        color,
      }}
    >
      <div className="font-medium truncate leading-tight">{title}</div>
    </div>
  );
}
