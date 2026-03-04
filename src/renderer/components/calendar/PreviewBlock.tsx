import { useCallback } from 'react';
import { HOUR_HEIGHT_PX } from './TimeGrid';

interface PreviewBlockProps {
  title: string;
  color: string;
  startMinutes: number;
  endMinutes: number;
  dayIndex: number;
  onResizeStart: (clientX: number, clientY: number) => void;
  onMoveStart: (clientX: number, clientY: number) => void;
}

export default function PreviewBlock({
  title,
  color,
  startMinutes,
  endMinutes,
  dayIndex,
  onResizeStart,
  onMoveStart,
}: PreviewBlockProps) {
  const durationMinutes = Math.max(endMinutes - startMinutes, 15);
  const top = (startMinutes / 60) * HOUR_HEIGHT_PX;
  const height = Math.max((durationMinutes / 60) * HOUR_HEIGHT_PX, 15);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.button !== 0) return;
      onResizeStart(e.clientX, e.clientY);
    },
    [onResizeStart],
  );

  const handleMoveMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      onMoveStart(e.clientX, e.clientY);
    },
    [onMoveStart],
  );

  return (
    <div
      className="absolute rounded-md px-1.5 py-0.5 text-[10px] overflow-hidden z-20 cursor-grab group"
      style={{
        top,
        height,
        gridColumn: `${dayIndex + 2} / ${dayIndex + 3}`,
        left: 2,
        right: 2,
        backgroundColor: `${color}30`,
        borderLeft: `2px solid ${color}`,
        color,
      }}
      onMouseDown={handleMoveMouseDown}
    >
      <div className="font-medium truncate leading-tight">
        {title || '(No title)'}
      </div>

      {/* Bottom resize handle */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[6px] cursor-ns-resize z-10 group-hover:bg-black/10 rounded-b-md"
        onMouseDown={handleResizeMouseDown}
      />
    </div>
  );
}
