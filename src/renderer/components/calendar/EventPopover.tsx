import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { X, Clock, MapPin, Pencil, Trash2, Cloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEventStore } from '@/stores/event-store';
import type { CalendarEvent } from '@shared/types/event';

interface EventPopoverProps {
  event: CalendarEvent;
  anchorRect: DOMRect;
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
}

export default function EventPopover({ event, anchorRect, onClose, onEdit }: EventPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { deleteEvent } = useEventStore();
  const [confirming, setConfirming] = useState(false);

  const start = new Date(event.startTime);
  const end = new Date(event.endTime);
  const color = event.color || '#003262';

  // Position: try right of block, fall back to left
  const popoverWidth = 280;
  const popoverHeight = 240;
  let left = anchorRect.right + 8;
  let top = anchorRect.top;

  if (left + popoverWidth > window.innerWidth - 16) {
    left = anchorRect.left - popoverWidth - 8;
  }
  if (top + popoverHeight > window.innerHeight - 16) {
    top = window.innerHeight - popoverHeight - 16;
  }
  if (top < 8) top = 8;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleDelete = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await deleteEvent(event.id);
    onClose();
  };

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-card border border-border rounded-lg shadow-lg"
      style={{ left, top, width: popoverWidth }}
    >
      {/* Color stripe header */}
      <div className="h-1.5 rounded-t-lg" style={{ backgroundColor: color }} />

      {/* Header */}
      <div className="flex items-start justify-between p-3 pb-0">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight">{event.title}</p>
          {event.source === 'google' && (
            <div className="flex items-center gap-1 mt-0.5">
              <Cloud className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">Google Calendar</span>
            </div>
          )}
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground ml-2 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Details */}
      <div className="px-3 pt-2 pb-1 space-y-1.5">
        <div className="flex items-center gap-2 text-xs">
          <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span>
            {event.allDay
              ? format(start, 'EEEE, MMM d')
              : `${format(start, 'EEEE, MMM d · h:mm a')} – ${format(end, 'h:mm a')}`}
          </span>
        </div>
        {event.location && (
          <div className="flex items-center gap-2 text-xs">
            <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="truncate">{event.location}</span>
          </div>
        )}
        {event.description && (
          <p className="text-xs text-muted-foreground line-clamp-3 mt-1">{event.description}</p>
        )}
      </div>

      {/* Actions */}
      {!confirming ? (
        <div className="flex gap-2 p-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs h-8 gap-1"
            onClick={() => onEdit(event)}
          >
            <Pencil className="w-3 h-3" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs h-8 gap-1"
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="w-3 h-3" />
            Delete
          </Button>
        </div>
      ) : (
        <div className="px-3 pb-3 pt-2 space-y-2">
          <p className="text-xs text-muted-foreground">Are you sure you want to delete this event?</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs h-8"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="flex-1 text-xs h-8"
              onClick={handleDelete}
            >
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
