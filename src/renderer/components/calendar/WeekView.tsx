import { useRef, useEffect, useState, useCallback } from 'react';
import { eachDayOfInterval } from 'date-fns';
import { useCalendarStore } from '@/stores/calendar-store';
import { useAssignmentStore } from '@/stores/assignment-store';
import { useEventStore } from '@/stores/event-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import TimeGrid from './TimeGrid';
import DayColumn from './DayColumn';
import DayHeader from './DayHeader';
import AssignmentPopover from './AssignmentPopover';
import EventPopover from './EventPopover';
import EventCreateModal from './EventCreateModal';
import { HOUR_HEIGHT_PX } from './TimeGrid';
import type { Assignment } from '@shared/types/assignment';
import type { CalendarEvent } from '@shared/types/event';

interface CreateModalState {
  date: Date;
  hour: number;
  minutes: number;
  editEvent?: CalendarEvent;
}

export default function WeekView() {
  const { weekStart, weekEnd } = useCalendarStore();
  const { assignments } = useAssignmentStore();
  const { events } = useEventStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Track when a popover was just dismissed to prevent click-through
  const popoverClosedAt = useRef(0);

  const [selectedAssignment, setSelectedAssignment] = useState<{
    assignment: Assignment;
    rect: DOMRect;
  } | null>(null);

  const [selectedEvent, setSelectedEvent] = useState<{
    event: CalendarEvent;
    rect: DOMRect;
  } | null>(null);

  const [createModal, setCreateModal] = useState<CreateModalState | null>(null);

  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  // Auto-scroll to 8 AM on mount
  useEffect(() => {
    const scrollEl = scrollRef.current?.querySelector('[data-scroll-area]') || scrollRef.current?.firstElementChild;
    if (scrollEl) {
      scrollEl.scrollTop = 8 * HOUR_HEIGHT_PX - 20;
    }
  }, [weekStart]);

  // Close popovers on week change
  useEffect(() => {
    setSelectedAssignment(null);
    setSelectedEvent(null);
    setCreateModal(null);
  }, [weekStart]);

  const hasOpenPopover = selectedAssignment !== null || selectedEvent !== null;

  const handleSelectAssignment = useCallback((assignment: Assignment, rect: DOMRect) => {
    // If a popover was just closed by click-outside, don't open a new one
    if (Date.now() - popoverClosedAt.current < 100) return;

    const key = `${assignment.source}-${assignment.id}`;
    const currentKey = selectedAssignment
      ? `${selectedAssignment.assignment.source}-${selectedAssignment.assignment.id}`
      : null;

    setSelectedEvent(null);

    if (key === currentKey) {
      setSelectedAssignment(null);
    } else {
      setSelectedAssignment({ assignment, rect });
    }
  }, [selectedAssignment]);

  const handleSelectEvent = useCallback((event: CalendarEvent, rect: DOMRect) => {
    // If a popover was just closed by click-outside, don't open a new one
    if (Date.now() - popoverClosedAt.current < 100) return;

    setSelectedAssignment(null);

    if (selectedEvent?.event.id === event.id) {
      setSelectedEvent(null);
    } else {
      setSelectedEvent({ event, rect });
    }
  }, [selectedEvent]);

  const handleCloseAssignmentPopover = useCallback(() => {
    popoverClosedAt.current = Date.now();
    setSelectedAssignment(null);
  }, []);

  const handleCloseEventPopover = useCallback(() => {
    popoverClosedAt.current = Date.now();
    setSelectedEvent(null);
  }, []);

  const handleClickEmptySlot = useCallback((day: Date, hour: number, minutes: number) => {
    // If a popover is open, just close it — don't open the create modal
    if (Date.now() - popoverClosedAt.current < 100) return;
    setSelectedAssignment(null);
    setSelectedEvent(null);
    setCreateModal({ date: day, hour, minutes });
  }, []);

  const handleEditEvent = useCallback((event: CalendarEvent) => {
    setSelectedEvent(null);
    const start = new Date(event.startTime);
    setCreateModal({
      date: start,
      hour: start.getHours(),
      minutes: start.getMinutes(),
      editEvent: event,
    });
  }, []);

  const handleCloseModal = useCallback(() => {
    setCreateModal(null);
  }, []);

  // Keep popover data in sync with store
  const selectedAssignmentKey = selectedAssignment
    ? `${selectedAssignment.assignment.source}-${selectedAssignment.assignment.id}`
    : null;
  const liveAssignment = selectedAssignmentKey
    ? assignments.find((a) => `${a.source}-${a.id}` === selectedAssignmentKey)
    : null;

  const liveEvent = selectedEvent
    ? events.find((e) => e.id === selectedEvent.event.id)
    : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Day headers row */}
      <div className="grid shrink-0" style={{ gridTemplateColumns: '60px repeat(7, 1fr)' }}>
        <div className="border-b border-border" />
        {days.map((day, i) => (
          <DayHeader key={i} day={day} />
        ))}
      </div>

      {/* Scrollable time grid + day columns */}
      <ScrollArea ref={scrollRef} className="flex-1">
        <div className="grid" style={{ gridTemplateColumns: '60px repeat(7, 1fr)' }}>
          <div className="relative">
            <TimeGrid />
          </div>
          {days.map((day, i) => (
            <DayColumn
              key={i}
              day={day}
              assignments={assignments}
              events={events}
              selectedAssignmentId={selectedAssignmentKey}
              selectedEventId={selectedEvent?.event.id ?? null}
              onSelectAssignment={handleSelectAssignment}
              onSelectEvent={handleSelectEvent}
              onClickEmptySlot={handleClickEmptySlot}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Assignment detail popover */}
      {selectedAssignment && liveAssignment && (
        <AssignmentPopover
          assignment={liveAssignment}
          anchorRect={selectedAssignment.rect}
          onClose={handleCloseAssignmentPopover}
        />
      )}

      {/* Event detail popover */}
      {selectedEvent && liveEvent && (
        <EventPopover
          event={liveEvent}
          anchorRect={selectedEvent.rect}
          onClose={handleCloseEventPopover}
          onEdit={handleEditEvent}
        />
      )}

      {/* Event create/edit modal */}
      {createModal && (
        <EventCreateModal
          date={createModal.date}
          hour={createModal.hour}
          minutes={createModal.minutes}
          editEvent={createModal.editEvent}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
}
