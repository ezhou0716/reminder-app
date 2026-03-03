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
  assignments: Assignment[];
  events: CalendarEvent[];
  selectedAssignmentId: string | null;
  selectedEventId: string | null;
  onSelectAssignment: (assignment: Assignment, rect: DOMRect) => void;
  onSelectEvent: (event: CalendarEvent, rect: DOMRect) => void;
  onClickEmptySlot: (day: Date, hour: number, minutes: number) => void;
}

export interface EventLayout {
  event: CalendarEvent;
  column: number;
  totalColumns: number;
}

/**
 * Compute Google-style overlap layout for events.
 * Groups overlapping events into clusters, then assigns column positions.
 * Shorter events are placed in later columns (rendered on top).
 */
function computeEventLayout(events: CalendarEvent[]): EventLayout[] {
  if (events.length === 0) return [];

  // Get start/end in minutes for each event
  const items = events.map((event) => {
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    const startMin = start.getHours() * 60 + start.getMinutes();
    const endMin = Math.max(end.getHours() * 60 + end.getMinutes(), startMin + 15);
    return { event, startMin, endMin, duration: endMin - startMin };
  });

  // Sort by start time, then longer events first (so they get earlier columns)
  items.sort((a, b) => a.startMin - b.startMin || b.duration - a.duration);

  // Group into overlap clusters
  const clusters: (typeof items)[] = [];
  let currentCluster = [items[0]];
  let clusterEnd = items[0].endMin;

  for (let i = 1; i < items.length; i++) {
    const item = items[i];
    if (item.startMin < clusterEnd) {
      // Overlaps with current cluster
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
  const result: EventLayout[] = [];
  for (const cluster of clusters) {
    const columns: { endMin: number }[] = [];

    for (const item of cluster) {
      // Find the first column where this event fits (no overlap)
      let placed = false;
      for (let col = 0; col < columns.length; col++) {
        if (item.startMin >= columns[col].endMin) {
          columns[col].endMin = item.endMin;
          result.push({ event: item.event, column: col, totalColumns: 0 });
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push({ endMin: item.endMin });
        result.push({ event: item.event, column: columns.length - 1, totalColumns: 0 });
      }
    }

    // Set totalColumns for all items in this cluster
    const total = columns.length;
    for (const r of result) {
      if (r.totalColumns === 0) {
        r.totalColumns = total;
      }
    }
  }

  return result;
}

export default function DayColumn({
  day,
  assignments,
  events,
  selectedAssignmentId,
  selectedEventId,
  onSelectAssignment,
  onSelectEvent,
  onClickEmptySlot,
}: DayColumnProps) {
  const dayAssignments = assignments.filter((a) =>
    isSameDay(new Date(a.dueAt), day),
  );

  const dayEvents = events.filter((e) => {
    const start = new Date(e.startTime);
    const end = new Date(e.endTime);
    return isSameDay(start, day) || isSameDay(end, day) || (start < day && end > day);
  });

  const eventLayouts = useMemo(() => computeEventLayout(dayEvents), [dayEvents]);

  const handleColumnClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const totalMinutes = (y / HOUR_HEIGHT_PX) * 60;

      const snapped = Math.round(totalMinutes / 15) * 15;
      const hour = Math.floor(snapped / 60);
      const minutes = snapped % 60;

      onClickEmptySlot(day, hour, minutes);
    },
    [day, onClickEmptySlot],
  );

  return (
    <div
      className="relative border-l border-border/50"
      style={{ height: TOTAL_HEIGHT }}
      onClick={handleColumnClick}
    >
      <CurrentTimeLine day={day} />
      {dayAssignments.map((a) => (
        <AssignmentBlock
          key={`${a.source}-${a.id}`}
          assignment={a}
          selected={selectedAssignmentId === `${a.source}-${a.id}`}
          onSelect={onSelectAssignment}
        />
      ))}
      {eventLayouts.map((layout) => (
        <EventBlock
          key={layout.event.id}
          event={layout.event}
          column={layout.column}
          totalColumns={layout.totalColumns}
          selected={selectedEventId === layout.event.id}
          onSelect={onSelectEvent}
        />
      ))}
    </div>
  );
}
