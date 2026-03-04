import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { eachDayOfInterval, isSameDay } from 'date-fns';
import { useCalendarStore } from '@/stores/calendar-store';
import { useAssignmentStore } from '@/stores/assignment-store';
import { useEventStore } from '@/stores/event-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import TimeGrid from './TimeGrid';
import DayColumn from './DayColumn';
import DayHeader from './DayHeader';
import AssignmentPopover from './AssignmentPopover';
import InlineEditCard from './InlineEditCard';
import EventCreateModal from './EventCreateModal';
import DragPreview from './DragPreview';
import PreviewBlock from './PreviewBlock';
import ProposalBlock from './ProposalBlock';
import { HOUR_HEIGHT_PX } from './TimeGrid';
import { useChatStore } from '@/stores/chat-store';
import type { Assignment } from '@shared/types/assignment';
import type { CalendarEvent } from '@shared/types/event';

interface InlineCardState {
  anchorRect: DOMRect;
  date: Date;
  hour: number;
  minutes: number;
  editEvent?: CalendarEvent;
}

interface FullModalState {
  date: Date;
  hour: number;
  minutes: number;
  editEvent?: CalendarEvent;
  prefill?: { title: string; startTime: string; endTime: string; color: string };
}

interface PreviewEvent {
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  title: string;
  color: string;
}

interface DragState {
  type: 'move' | 'resize-top' | 'resize-bottom' | 'preview-resize-bottom' | 'preview-move';
  event: CalendarEvent;
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  isDragging: boolean;
  // Preview positioning
  previewStartMinutes: number;
  previewEndMinutes: number;
  previewDayIndex: number;
  // Original values for cancel
  originalStartMinutes: number;
  originalEndMinutes: number;
  originalDayIndex: number;
}

const DRAG_THRESHOLD = 4; // px before a mousedown becomes a drag

function snapTo15(minutes: number): number {
  return Math.round(minutes / 15) * 15;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export default function WeekView() {
  const { weekStart, weekEnd } = useCalendarStore();
  const { assignments } = useAssignmentStore();
  const { events, updateEvent } = useEventStore();
  const { proposals, acceptedProposalIds, rejectedProposalIds, acceptProposal, rejectProposal } = useChatStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const [selectedAssignment, setSelectedAssignment] = useState<{
    assignment: Assignment;
    rect: DOMRect;
  } | null>(null);

  const [inlineCard, setInlineCard] = useState<InlineCardState | null>(null);
  const [fullModal, setFullModal] = useState<FullModalState | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [previewEvent, setPreviewEvent] = useState<PreviewEvent | null>(null);

  const dragStateRef = useRef<DragState | null>(null);
  const autoScrollRef = useRef<number | null>(null);
  const justFinishedDragRef = useRef(false);

  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  // Auto-scroll to 8 AM on mount
  useEffect(() => {
    const scrollEl = scrollRef.current?.querySelector('[data-scroll-area]') || scrollRef.current?.firstElementChild;
    if (scrollEl) {
      scrollEl.scrollTop = 8 * HOUR_HEIGHT_PX - 20;
    }
  }, [weekStart]);

  // Close everything on week change
  useEffect(() => {
    setSelectedAssignment(null);
    setInlineCard(null);
    setFullModal(null);
    setDragState(null);
    setPreviewEvent(null);
    dragStateRef.current = null;
  }, [weekStart]);

  const hasOpenPopover = selectedAssignment !== null || inlineCard !== null;

  // ─── Helpers for coordinate → time conversion ───

  const getScrollContainer = useCallback((): HTMLElement | null => {
    if (!scrollRef.current) return null;
    return scrollRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
  }, []);

  const clientYToMinutes = useCallback((clientY: number): number => {
    if (!gridRef.current) return 0;
    const gridRect = gridRef.current.getBoundingClientRect();
    // getBoundingClientRect already accounts for scroll position
    const y = clientY - gridRect.top;
    return (y / HOUR_HEIGHT_PX) * 60;
  }, []);

  const clientXToDayIndex = useCallback((clientX: number): number => {
    if (!gridRef.current) return 0;
    // Find day columns by data-day-index attribute
    const columns = gridRef.current.querySelectorAll('[data-day-index]');
    for (let i = 0; i < columns.length; i++) {
      const rect = columns[i].getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) {
        return i;
      }
    }
    // If mouse is to the left of first column, return 0; if right of last, return 6
    if (columns.length > 0) {
      const first = columns[0].getBoundingClientRect();
      if (clientX < first.left) return 0;
      return columns.length - 1;
    }
    return 0;
  }, []);

  const getDayIndexForEvent = useCallback((event: CalendarEvent): number => {
    const start = new Date(event.startTime);
    for (let i = 0; i < days.length; i++) {
      if (isSameDay(start, days[i])) return i;
    }
    return 0;
  }, [days]);

  // ─── Assignment selection ───

  const handleSelectAssignment = useCallback((assignment: Assignment, rect: DOMRect) => {
    // During event creation, any outside click just dismisses
    if (previewEvent) {
      setInlineCard(null);
      setPreviewEvent(null);
      return;
    }

    const key = `${assignment.source}-${assignment.id}`;
    const currentKey = selectedAssignment
      ? `${selectedAssignment.assignment.source}-${selectedAssignment.assignment.id}`
      : null;

    setInlineCard(null);

    if (key === currentKey) {
      setSelectedAssignment(null);
    } else {
      setSelectedAssignment({ assignment, rect });
    }
  }, [selectedAssignment, previewEvent]);

  const handleDismissPopover = useCallback(() => {
    setSelectedAssignment(null);
    setInlineCard(null);
    setPreviewEvent(null);
  }, []);

  // ─── Empty slot click (opens inline card for new event) ───

  const handleClickEmptySlot = useCallback((day: Date, hour: number, minutes: number, anchorRect: DOMRect) => {
    if (dragStateRef.current?.isDragging) return;
    if (justFinishedDragRef.current) return;
    setSelectedAssignment(null);

    // If preview is already active, clicking empty space just dismisses
    if (previewEvent) {
      setInlineCard(null);
      setPreviewEvent(null);
      return;
    }

    const dayIndex = days.findIndex((d) => isSameDay(d, day));
    const startMinutes = hour * 60 + minutes;
    const endMinutes = startMinutes + 60;

    setPreviewEvent({
      dayIndex: dayIndex >= 0 ? dayIndex : 0,
      startMinutes,
      endMinutes,
      title: '',
      color: '#003262',
    });

    // anchorRect will be recomputed from preview in the render via useMemo
    setInlineCard({ anchorRect, date: day, hour, minutes });
  }, [days, previewEvent]);

  // ─── Inline card callbacks ───

  const handleInlineCardSave = useCallback(() => {
    setInlineCard(null);
    setPreviewEvent(null);
  }, []);

  const handleExpandToModal = useCallback((prefill: { title: string; startTime: string; endTime: string; color: string }) => {
    const card = inlineCard;
    setInlineCard(null);
    setPreviewEvent(null);
    if (card) {
      setFullModal({
        date: card.date,
        hour: card.hour,
        minutes: card.minutes,
        editEvent: card.editEvent,
        prefill,
      });
    }
  }, [inlineCard]);

  const handleCloseModal = useCallback(() => {
    setFullModal(null);
  }, []);

  // ─── Drag: initiation ───

  const handleDragStart = useCallback((event: CalendarEvent, clientX: number, clientY: number) => {
    // During event creation, clicking an existing event just dismisses
    if (previewEvent) {
      setInlineCard(null);
      setPreviewEvent(null);
      return;
    }

    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    const startMin = start.getHours() * 60 + start.getMinutes();
    const endMin = end.getHours() * 60 + end.getMinutes();
    const dayIdx = getDayIndexForEvent(event);

    const state: DragState = {
      type: 'move',
      event,
      startClientX: clientX,
      startClientY: clientY,
      currentClientX: clientX,
      currentClientY: clientY,
      isDragging: false,
      previewStartMinutes: startMin,
      previewEndMinutes: Math.max(endMin, startMin + 15),
      previewDayIndex: dayIdx,
      originalStartMinutes: startMin,
      originalEndMinutes: Math.max(endMin, startMin + 15),
      originalDayIndex: dayIdx,
    };

    dragStateRef.current = state;
    setDragState(state);
    setInlineCard(null);
    setSelectedAssignment(null);
  }, [getDayIndexForEvent, previewEvent]);

  const handleResizeStart = useCallback((event: CalendarEvent, edge: 'top' | 'bottom', clientX: number, clientY: number) => {
    // During event creation, clicking an existing event's resize handle just dismisses
    if (previewEvent) {
      setInlineCard(null);
      setPreviewEvent(null);
      return;
    }

    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    const startMin = start.getHours() * 60 + start.getMinutes();
    const endMin = end.getHours() * 60 + end.getMinutes();
    const dayIdx = getDayIndexForEvent(event);

    const state: DragState = {
      type: edge === 'top' ? 'resize-top' : 'resize-bottom',
      event,
      startClientX: clientX,
      startClientY: clientY,
      currentClientX: clientX,
      currentClientY: clientY,
      isDragging: false,
      previewStartMinutes: startMin,
      previewEndMinutes: Math.max(endMin, startMin + 15),
      previewDayIndex: dayIdx,
      originalStartMinutes: startMin,
      originalEndMinutes: Math.max(endMin, startMin + 15),
      originalDayIndex: dayIdx,
    };

    dragStateRef.current = state;
    setDragState(state);
    setInlineCard(null);
    setSelectedAssignment(null);
  }, [getDayIndexForEvent, previewEvent]);

  // ─── Preview drag: resize + move initiation ───

  const handlePreviewResizeStart = useCallback((clientX: number, clientY: number) => {
    if (!previewEvent) return;
    const dummyEvent = { id: '__preview__', title: previewEvent.title, startTime: '', endTime: '', color: previewEvent.color } as CalendarEvent;

    const state: DragState = {
      type: 'preview-resize-bottom',
      event: dummyEvent,
      startClientX: clientX,
      startClientY: clientY,
      currentClientX: clientX,
      currentClientY: clientY,
      isDragging: false,
      previewStartMinutes: previewEvent.startMinutes,
      previewEndMinutes: previewEvent.endMinutes,
      previewDayIndex: previewEvent.dayIndex,
      originalStartMinutes: previewEvent.startMinutes,
      originalEndMinutes: previewEvent.endMinutes,
      originalDayIndex: previewEvent.dayIndex,
    };

    dragStateRef.current = state;
    setDragState(state);
  }, [previewEvent]);

  const handlePreviewMoveStart = useCallback((clientX: number, clientY: number) => {
    if (!previewEvent) return;
    const dummyEvent = { id: '__preview__', title: previewEvent.title, startTime: '', endTime: '', color: previewEvent.color } as CalendarEvent;

    const state: DragState = {
      type: 'preview-move',
      event: dummyEvent,
      startClientX: clientX,
      startClientY: clientY,
      currentClientX: clientX,
      currentClientY: clientY,
      isDragging: false,
      previewStartMinutes: previewEvent.startMinutes,
      previewEndMinutes: previewEvent.endMinutes,
      previewDayIndex: previewEvent.dayIndex,
      originalStartMinutes: previewEvent.startMinutes,
      originalEndMinutes: previewEvent.endMinutes,
      originalDayIndex: previewEvent.dayIndex,
    };

    dragStateRef.current = state;
    setDragState(state);
  }, [previewEvent]);

  // ─── Drag: document-level mouse listeners ───

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      const ds = dragStateRef.current;
      if (!ds) return;

      const dx = e.clientX - ds.startClientX;
      const dy = e.clientY - ds.startClientY;

      if (!ds.isDragging && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) {
        return;
      }

      const newState = { ...ds, currentClientX: e.clientX, currentClientY: e.clientY, isDragging: true };
      document.body.style.userSelect = 'none';

      if (ds.type === 'move') {
        const minutes = clientYToMinutes(e.clientY);
        const duration = ds.originalEndMinutes - ds.originalStartMinutes;
        // The mouse grabbed in the middle of the event — compute offset
        const originalGrabMinutes = clientYToMinutes(ds.startClientY);
        const offset = originalGrabMinutes - ds.originalStartMinutes;
        const newStart = snapTo15(clamp(minutes - offset, 0, 1440 - duration));
        newState.previewStartMinutes = newStart;
        newState.previewEndMinutes = newStart + duration;
        newState.previewDayIndex = clientXToDayIndex(e.clientX);

        document.body.style.cursor = 'grabbing';
      } else if (ds.type === 'resize-top') {
        const minutes = snapTo15(clamp(clientYToMinutes(e.clientY), 0, ds.originalEndMinutes - 15));
        newState.previewStartMinutes = minutes;

        document.body.style.cursor = 'ns-resize';
      } else if (ds.type === 'resize-bottom') {
        const minutes = snapTo15(clamp(clientYToMinutes(e.clientY), ds.originalStartMinutes + 15, 1440));
        newState.previewEndMinutes = minutes;

        document.body.style.cursor = 'ns-resize';
      } else if (ds.type === 'preview-resize-bottom') {
        const minutes = snapTo15(clamp(clientYToMinutes(e.clientY), ds.originalStartMinutes + 15, 1440));
        newState.previewEndMinutes = minutes;

        document.body.style.cursor = 'ns-resize';
      } else if (ds.type === 'preview-move') {
        const minutes = clientYToMinutes(e.clientY);
        const duration = ds.originalEndMinutes - ds.originalStartMinutes;
        const originalGrabMinutes = clientYToMinutes(ds.startClientY);
        const offset = originalGrabMinutes - ds.originalStartMinutes;
        const newStart = snapTo15(clamp(minutes - offset, 0, 1440 - duration));
        newState.previewStartMinutes = newStart;
        newState.previewEndMinutes = newStart + duration;
        newState.previewDayIndex = clientXToDayIndex(e.clientX);

        document.body.style.cursor = 'grabbing';
      }

      dragStateRef.current = newState;
      setDragState(newState);

      // For preview drag types, update the previewEvent state in real-time
      if (ds.type === 'preview-resize-bottom') {
        setPreviewEvent((prev) => prev ? { ...prev, endMinutes: newState.previewEndMinutes } : null);
      } else if (ds.type === 'preview-move') {
        setPreviewEvent((prev) => prev ? {
          ...prev,
          startMinutes: newState.previewStartMinutes,
          endMinutes: newState.previewEndMinutes,
          dayIndex: newState.previewDayIndex,
        } : null);
      }

      // Auto-scroll
      const scrollEl = getScrollContainer();
      if (scrollEl) {
        const scrollRect = scrollEl.getBoundingClientRect();
        const nearTop = e.clientY - scrollRect.top < 40;
        const nearBottom = scrollRect.bottom - e.clientY < 40;

        if (nearTop || nearBottom) {
          if (!autoScrollRef.current) {
            const scrollStep = () => {
              const currentDs = dragStateRef.current;
              if (!currentDs?.isDragging) {
                if (autoScrollRef.current) {
                  cancelAnimationFrame(autoScrollRef.current);
                  autoScrollRef.current = null;
                }
                return;
              }
              const sr = scrollEl.getBoundingClientRect();
              const isNearTop = currentDs.currentClientY - sr.top < 40;
              const isNearBottom = sr.bottom - currentDs.currentClientY < 40;
              if (isNearTop) scrollEl.scrollTop -= 4;
              else if (isNearBottom) scrollEl.scrollTop += 4;

              if (isNearTop || isNearBottom) {
                autoScrollRef.current = requestAnimationFrame(scrollStep);
              } else {
                autoScrollRef.current = null;
              }
            };
            autoScrollRef.current = requestAnimationFrame(scrollStep);
          }
        } else if (autoScrollRef.current) {
          cancelAnimationFrame(autoScrollRef.current);
          autoScrollRef.current = null;
        }
      }
    }

    function handleMouseUp(_e: MouseEvent) {
      const ds = dragStateRef.current;
      if (!ds) return;

      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      if (autoScrollRef.current) {
        cancelAnimationFrame(autoScrollRef.current);
        autoScrollRef.current = null;
      }

      if (ds.type === 'preview-resize-bottom' || ds.type === 'preview-move') {
        // Finalize preview position — no API call, event isn't saved yet
        setPreviewEvent((prev) => prev ? {
          ...prev,
          startMinutes: ds.previewStartMinutes,
          endMinutes: ds.previewEndMinutes,
          dayIndex: ds.previewDayIndex,
        } : null);
        dragStateRef.current = null;
        setDragState(null);
        return;
      }

      if (ds.isDragging) {
        // Commit the change
        const event = ds.event;
        const start = new Date(event.startTime);
        const end = new Date(event.endTime);

        if (ds.type === 'move') {
          // Compute new day
          const targetDay = days[ds.previewDayIndex];
          const newStart = new Date(targetDay);
          newStart.setHours(0, ds.previewStartMinutes, 0, 0);
          const newEnd = new Date(targetDay);
          newEnd.setHours(0, ds.previewEndMinutes, 0, 0);

          updateEvent(event.id, {
            startTime: newStart.toISOString(),
            endTime: newEnd.toISOString(),
          });
        } else if (ds.type === 'resize-top') {
          const newStart = new Date(start);
          newStart.setHours(0, ds.previewStartMinutes, 0, 0);
          updateEvent(event.id, {
            startTime: newStart.toISOString(),
          });
        } else if (ds.type === 'resize-bottom') {
          const newEnd = new Date(end);
          newEnd.setHours(0, ds.previewEndMinutes, 0, 0);
          updateEvent(event.id, {
            endTime: newEnd.toISOString(),
          });
        }
      }

      if (!ds.isDragging) {
        // It was a click, not a drag — toggle inline card for this event
        const clickedEvent = ds.event;
        setInlineCard((prev) => {
          if (prev?.editEvent?.id === clickedEvent.id) {
            return null; // Toggle off
          }
          const anchorRect = new DOMRect(ds.startClientX, ds.startClientY - 10, 0, 20);
          const start = new Date(clickedEvent.startTime);
          return {
            anchorRect,
            date: start,
            hour: start.getHours(),
            minutes: start.getMinutes(),
            editEvent: clickedEvent,
          };
        });
      } else {
        // A drag just finished — suppress the click event that follows mouseup
        justFinishedDragRef.current = true;
        requestAnimationFrame(() => { justFinishedDragRef.current = false; });
      }

      dragStateRef.current = null;
      setDragState(null);
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && dragStateRef.current?.isDragging) {
        // Cancel drag
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (autoScrollRef.current) {
          cancelAnimationFrame(autoScrollRef.current);
          autoScrollRef.current = null;
        }
        dragStateRef.current = null;
        setDragState(null);
      }
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keydown', handleKeyDown);
      if (autoScrollRef.current) {
        cancelAnimationFrame(autoScrollRef.current);
      }
    };
  }, [clientYToMinutes, clientXToDayIndex, days, updateEvent, getScrollContainer]);

  // Keep popover data in sync with store
  const selectedAssignmentKey = selectedAssignment
    ? `${selectedAssignment.assignment.source}-${selectedAssignment.assignment.id}`
    : null;
  const liveAssignment = selectedAssignmentKey
    ? assignments.find((a) => `${a.source}-${a.id}` === selectedAssignmentKey)
    : null;

  const liveEditEvent = inlineCard?.editEvent
    ? events.find((e) => e.id === inlineCard.editEvent!.id)
    : null;

  const draggingEventId = dragState?.isDragging ? dragState.event.id : null;

  // ─── onChange handler from InlineEditCard → update preview ───

  const handlePreviewChange = useCallback((fields: { title?: string; startMinutes?: number; endMinutes?: number; color?: string }) => {
    setPreviewEvent((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        ...(fields.title !== undefined && { title: fields.title }),
        ...(fields.startMinutes !== undefined && { startMinutes: fields.startMinutes }),
        ...(fields.endMinutes !== undefined && { endMinutes: fields.endMinutes }),
        ...(fields.color !== undefined && { color: fields.color }),
      };
    });
  }, []);

  // ─── Compute anchor rect from preview block grid geometry ───

  const previewAnchorRect = useMemo(() => {
    if (!previewEvent || !gridRef.current) return null;
    const columns = gridRef.current.querySelectorAll('[data-day-index]');
    const col = columns[previewEvent.dayIndex] as HTMLElement | undefined;
    if (!col) return null;

    const colRect = col.getBoundingClientRect();
    const top = colRect.top + (previewEvent.startMinutes / 60) * HOUR_HEIGHT_PX;
    const height = ((previewEvent.endMinutes - previewEvent.startMinutes) / 60) * HOUR_HEIGHT_PX;

    return new DOMRect(colRect.left, top, colRect.width, height);
  }, [previewEvent]);

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
        <div ref={gridRef} className="grid relative" style={{ gridTemplateColumns: '60px repeat(7, 1fr)' }}>
          <div className="relative">
            <TimeGrid />
          </div>
          {days.map((day, i) => (
            <DayColumn
              key={i}
              day={day}
              dayIndex={i}
              assignments={assignments}
              events={events}
              selectedAssignmentId={selectedAssignmentKey}
              selectedEventId={inlineCard?.editEvent?.id ?? null}
              draggingEventId={draggingEventId}
              onSelectAssignment={handleSelectAssignment}
              onClickEmptySlot={handleClickEmptySlot}
              onDragStart={handleDragStart}
              onResizeStart={handleResizeStart}
            />
          ))}

          {/* Drag preview ghost */}
          {dragState?.isDragging && !dragState.type.startsWith('preview-') && (
            <DragPreview
              title={dragState.event.title}
              color={dragState.event.color || '#003262'}
              startMinutes={dragState.previewStartMinutes}
              endMinutes={dragState.previewEndMinutes}
              dayIndex={dragState.previewDayIndex}
            />
          )}

          {/* New event preview block */}
          {previewEvent && !inlineCard?.editEvent && (
            <PreviewBlock
              title={previewEvent.title}
              color={previewEvent.color}
              startMinutes={previewEvent.startMinutes}
              endMinutes={previewEvent.endMinutes}
              dayIndex={previewEvent.dayIndex}
              onResizeStart={handlePreviewResizeStart}
              onMoveStart={handlePreviewMoveStart}
            />
          )}

          {/* AI proposal ghost blocks */}
          {proposals.map((proposal) => {
            if (proposal.type === 'delete') return null;
            const time = proposal.type === 'create' ? proposal.event.startTime : proposal.changes.startTime;
            if (!time) return null;
            const proposalDate = new Date(time);
            const dayIdx = days.findIndex((d) => isSameDay(d, proposalDate));
            if (dayIdx < 0) return null;
            return (
              <ProposalBlock
                key={proposal.id}
                proposal={proposal}
                dayIndex={dayIdx}
                onAccept={acceptProposal}
                onReject={rejectProposal}
                isAccepted={acceptedProposalIds.has(proposal.id)}
                isRejected={rejectedProposalIds.has(proposal.id)}
              />
            );
          })}
        </div>
      </ScrollArea>

      {/* Overlay to capture outside clicks when a popover is open */}
      {/* Skip overlay when preview block is active — it would block resize/drag on the preview */}
      {hasOpenPopover && !previewEvent && (
        <div className="fixed inset-0 z-40" onClick={handleDismissPopover} />
      )}

      {/* Assignment detail popover */}
      {selectedAssignment && liveAssignment && (
        <AssignmentPopover
          assignment={liveAssignment}
          anchorRect={selectedAssignment.rect}
          onClose={handleDismissPopover}
        />
      )}

      {/* Inline edit card (replaces EventPopover and empty-slot modal) */}
      {inlineCard && (
        <InlineEditCard
          anchorRect={(!inlineCard.editEvent && previewAnchorRect) ? previewAnchorRect : inlineCard.anchorRect}
          date={inlineCard.date}
          hour={inlineCard.hour}
          minutes={inlineCard.minutes}
          editEvent={inlineCard.editEvent ? (liveEditEvent ?? inlineCard.editEvent) : undefined}
          onClose={handleDismissPopover}
          onSave={handleInlineCardSave}
          onExpandToModal={handleExpandToModal}
          onChange={!inlineCard.editEvent ? handlePreviewChange : undefined}
          previewStartMinutes={previewEvent?.startMinutes}
          previewEndMinutes={previewEvent?.endMinutes}
        />
      )}

      {/* Full event create/edit modal (from "More options") */}
      {fullModal && (
        <EventCreateModal
          date={fullModal.date}
          hour={fullModal.hour}
          minutes={fullModal.minutes}
          editEvent={fullModal.editEvent}
          prefill={fullModal.prefill}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
}
