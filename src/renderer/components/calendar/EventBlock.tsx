import { useCallback } from 'react';
import { HOUR_HEIGHT_PX } from './TimeGrid';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@shared/types/event';

interface EventBlockProps {
  event: CalendarEvent;
  column: number;
  totalColumns: number;
  selected?: boolean;
  isDragging?: boolean;
  onDragStart?: (event: CalendarEvent, clientX: number, clientY: number) => void;
  onResizeStart?: (event: CalendarEvent, edge: 'top' | 'bottom', clientX: number, clientY: number) => void;
}

const DEFAULT_COLOR = '#003262'; // Berkeley blue

export default function EventBlock({
  event,
  column,
  totalColumns,
  selected,
  isDragging,
  onDragStart,
  onResizeStart,
}: EventBlockProps) {
  const start = new Date(event.startTime);
  const end = new Date(event.endTime);

  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const durationMinutes = Math.max(endMinutes - startMinutes, 15);

  const top = (startMinutes / 60) * HOUR_HEIGHT_PX;
  const height = Math.max((durationMinutes / 60) * HOUR_HEIGHT_PX, 15);

  const color = event.color || DEFAULT_COLOR;
  const isTall = height >= 36;

  // Overlap layout: divide width among columns
  const padding = 2; // px gap on each side
  const widthPercent = 100 / totalColumns;
  const left = `calc(${column * widthPercent}% + ${padding}px)`;
  const width = `calc(${widthPercent}% - ${padding * 2}px)`;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // Only handle left click
    if (e.button !== 0) return;
    if (onDragStart) {
      onDragStart(event, e.clientX, e.clientY);
    }
  }, [event, onDragStart]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, edge: 'top' | 'bottom') => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (onResizeStart) {
      onResizeStart(event, edge, e.clientX, e.clientY);
    }
  }, [event, onResizeStart]);

  return (
    <div
      className={cn(
        'absolute rounded-md px-1.5 py-0.5 text-[10px] overflow-hidden cursor-pointer transition-all group',
        selected ? 'ring-2 ring-ring shadow-md z-10' : 'hover:opacity-90',
        isDragging && 'opacity-30',
      )}
      style={{
        top,
        height,
        left,
        width,
        backgroundColor: `${color}20`,
        borderLeft: `2px solid ${color}`,
        color,
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="font-medium truncate leading-tight">{event.title}</div>
      {isTall && event.location && (
        <div className="truncate leading-tight opacity-70">{event.location}</div>
      )}

      {/* Bottom resize handle */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[6px] cursor-ns-resize z-10 group-hover:bg-black/10 rounded-b-md"
        onMouseDown={(e) => handleResizeMouseDown(e, 'bottom')}
      />
    </div>
  );
}
