import { useRef } from 'react';
import { HOUR_HEIGHT_PX } from './TimeGrid';
import { cn } from '@/lib/utils';
import type { Assignment } from '@shared/types/assignment';

interface AssignmentBlockProps {
  assignment: Assignment;
  onSelect: (assignment: Assignment, rect: DOMRect) => void;
  selected?: boolean;
}

export default function AssignmentBlock({ assignment, onSelect, selected }: AssignmentBlockProps) {
  const ref = useRef<HTMLDivElement>(null);
  const due = new Date(assignment.dueAt);
  const dueMinutes = due.getHours() * 60 + due.getMinutes();

  // 30-minute block ending at due time
  const durationMinutes = 30;
  const startMinutes = dueMinutes - durationMinutes;
  const top = (startMinutes / 60) * HOUR_HEIGHT_PX;
  const height = (durationMinutes / 60) * HOUR_HEIGHT_PX;

  const done =
    (assignment.submitted && !assignment.dismissed) || !!assignment.completed;

  // Urgency colors
  const hoursLeft = (due.getTime() - Date.now()) / (1000 * 60 * 60);
  let bgColor = '#16a34a'; // green for assignments with time
  if (done) {
    bgColor = '#a1a1aa'; // muted gray
  } else if (hoursLeft < 3) {
    bgColor = '#dc2626'; // urgent red
  } else if (hoursLeft < 24) {
    bgColor = '#ea580c'; // warning orange
  }

  return (
    <div
      ref={ref}
      className={cn(
        'absolute left-1 right-1 rounded-md px-1.5 py-0.5 text-[10px] overflow-hidden cursor-pointer transition-all border-l-2',
        selected ? 'ring-2 ring-ring shadow-md z-10' : 'hover:opacity-90',
      )}
      style={{
        top,
        height,
        backgroundColor: done ? '#f4f4f5' : `${bgColor}15`,
        borderLeftColor: bgColor,
        color: done ? '#a1a1aa' : bgColor,
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (ref.current) {
          onSelect(assignment, ref.current.getBoundingClientRect());
        }
      }}
    >
      <div
        className={cn(
          'font-medium truncate leading-tight',
          done && 'line-through',
        )}
      >
        {assignment.courseName}
      </div>
      <div
        className={cn(
          'truncate leading-tight opacity-80',
          done && 'line-through',
        )}
      >
        {assignment.name}
      </div>
    </div>
  );
}
