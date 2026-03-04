import { useCallback, useMemo } from 'react';
import { isSameDay } from 'date-fns';
import { TOTAL_HEIGHT, HOUR_HEIGHT_PX } from './TimeGrid';
import CurrentTimeLine from './CurrentTimeLine';
import AssignmentBlock from './AssignmentBlock';
import EventBlock from './EventBlock';
import type { Assignment } from '@shared/types/assignment';
import type { CalendarEvent } from '@shared/types/event';

interface DayColumnProps {
  day: Date;
  dayIndex: number;
  assignments: Assignment[];
  events: CalendarEvent[];
  selectedAssignmentId: string | null;
  selectedEventId: string | null;
  draggingEventId: string | null;
  onSelectAssignment: (assignment: Assignment, rect: DOMRect) => void;
  onClickEmptySlot: (day: Date, hour: number, minutes: number, anchorRect: DOMRect) => void;
  onDragStart?: (event: CalendarEvent, clientX: number, clientY: number) => void;
  onResizeStart?: (event: CalendarEvent, edge: 'top' | 'bottom', clientX: number, clientY: number) => void;
}

/**
 * Compute Google-style overlap layout for a unified set of time blocks.
 * Groups overlapping blocks into clusters, assigns column positions.
 */
function computeOverlapLayout(blocks: { id: string; startMin: number; endMin: number }[]): Map<string, { column: number; totalColumns: number }> {
  const result = new Map<string, { column: number; totalColumns: number }>();
  if (blocks.length === 0) return result;

  // Sort by start time, then longer blocks first
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || (b.endMin - b.startMin) - (a.endMin - a.startMin));

  // Group into overlap clusters
  const clusters: (typeof sorted)[] = [];
  let currentCluster = [sorted[0]];
  let clusterEnd = sorted[0].endMin;

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    if (item.startMin < clusterEnd) {
      currentCluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.endMin);
    } else {
      clusters.push(currentCluster);
      currentCluster = [item];
      clusterEnd = item.endMin;
    }
  }
  clusters.push(currentCluster);

  // Assign columns within each cluster
  for (const cluster of clusters) {
    const columns: { endMin: number }[] = [];
    const clusterResults: { id: string; column: number }[] = [];

    for (const item of cluster) {
      let placed = false;
      for (let col = 0; col < columns.length; col++) {
        if (item.startMin >= columns[col].endMin) {
          columns[col].endMin = item.endMin;
          clusterResults.push({ id: item.id, column: col });
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push({ endMin: item.endMin });
        clusterResults.push({ id: item.id, column: columns.length - 1 });
      }
    }

    const total = columns.length;
    for (const r of clusterResults) {
      result.set(r.id, { column: r.column, totalColumns: total });
    }
  }

  return result;
}

export default function DayColumn({
  day,
  dayIndex,
  assignments,
  events,
  selectedAssignmentId,
  selectedEventId,
  draggingEventId,
  onSelectAssignment,
  onClickEmptySlot,
  onDragStart,
  onResizeStart,
}: DayColumnProps) {
  const dayAssignments = assignments.filter((a) =>
    !a.calendarRemoved && isSameDay(new Date(a.dueAt), day),
  );

  // Build a set of titles that correspond to pushed assignment events
  // so we can filter out duplicates that leaked back through Google sync
  const assignmentTitles = useMemo(() => {
    const titles = new Set<string>();
    for (const a of assignments) {
      titles.add(`${a.courseName}: ${a.name}`);
    }
    return titles;
  }, [assignments]);

  const dayEvents = events.filter((e) => {
    const start = new Date(e.startTime);
    const end = new Date(e.endTime);
    const isOnDay = isSameDay(start, day) || isSameDay(end, day) || (start < day && end > day);
    if (!isOnDay) return false;
    // Skip events that are assignment duplicates synced back from Google
    if (assignmentTitles.has(e.title)) return false;
    return true;
  });

  // Compute unified overlap layout for both assignments and events
  const layouts = useMemo(() => {
    const blocks: { id: string; startMin: number; endMin: number }[] = [];

    for (const a of dayAssignments) {
      const due = new Date(a.dueAt);
      const endMin = due.getHours() * 60 + due.getMinutes();
      const startMin = endMin - 30; // 30-min block
      blocks.push({ id: `a:${a.source}-${a.id}`, startMin, endMin });
    }

    for (const e of dayEvents) {
      const start = new Date(e.startTime);
      const end = new Date(e.endTime);
      const startMin = start.getHours() * 60 + start.getMinutes();
      const endMin = Math.max(end.getHours() * 60 + end.getMinutes(), startMin + 15);
      blocks.push({ id: `e:${e.id}`, startMin, endMin });
    }

    return computeOverlapLayout(blocks);
  }, [dayAssignments, dayEvents]);

  const handleColumnClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const totalMinutes = (y / HOUR_HEIGHT_PX) * 60;

      const snapped = Math.round(totalMinutes / 15) * 15;
      const hour = Math.floor(snapped / 60);
      const minutes = snapped % 60;

      // Create a small anchor rect around the click point for popover positioning
      const anchorRect = new DOMRect(e.clientX, e.clientY - 10, 0, 20);
      onClickEmptySlot(day, hour, minutes, anchorRect);
    },
    [day, onClickEmptySlot],
  );

  return (
    <div
      className="relative border-l border-border/50"
      style={{ height: TOTAL_HEIGHT }}
      data-day-index={dayIndex}
      onClick={handleColumnClick}
    >
      <CurrentTimeLine day={day} />
      {dayAssignments.map((a) => {
        const key = `a:${a.source}-${a.id}`;
        const layout = layouts.get(key) ?? { column: 0, totalColumns: 1 };
        return (
          <AssignmentBlock
            key={`${a.source}-${a.id}`}
            assignment={a}
            column={layout.column}
            totalColumns={layout.totalColumns}
            selected={selectedAssignmentId === `${a.source}-${a.id}`}
            onSelect={onSelectAssignment}
          />
        );
      })}
      {dayEvents.map((e) => {
        const key = `e:${e.id}`;
        const layout = layouts.get(key) ?? { column: 0, totalColumns: 1 };
        return (
          <EventBlock
            key={e.id}
            event={e}
            column={layout.column}
            totalColumns={layout.totalColumns}
            selected={selectedEventId === e.id}
            isDragging={draggingEventId === e.id}
            onDragStart={onDragStart}
            onResizeStart={onResizeStart}
          />
        );
      })}
    </div>
  );
}
