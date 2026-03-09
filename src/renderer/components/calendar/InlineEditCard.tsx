import { useState, useEffect, useRef } from 'react';
import { Trash2, Check, X, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEventStore } from '@/stores/event-store';
import type { CalendarEvent, RsvpResponse } from '@shared/types/event';
import { isPendingRsvp } from '@shared/types/event';

const EVENT_COLORS = [
  '#003262', // Berkeley blue
  '#039BE5', // Peacock
  '#3F51B5', // Blueberry
  '#7986CB', // Lavender
  '#8E24AA', // Grape
  '#E67C73', // Flamingo
  '#F4511E', // Tangerine
  '#F6BF26', // Banana
  '#33B679', // Sage
  '#0B8043', // Basil
  '#616161', // Graphite
];

interface InlineEditCardProps {
  anchorRect: DOMRect;
  date?: Date;
  hour?: number;
  minutes?: number;
  editEvent?: CalendarEvent;
  onClose: () => void;
  onSave: () => void;
  onExpandToModal: (prefill: { title: string; startTime: string; endTime: string; color: string }) => void;
  onDelete?: () => void;
  onChange?: (fields: { title?: string; startMinutes?: number; endMinutes?: number; color?: string }) => void;
  previewStartMinutes?: number;
  previewEndMinutes?: number;
}

function toTimeInputValue(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function parseTimeInput(dateBase: Date, timeStr: string): Date {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date(dateBase);
  d.setHours(h, m, 0, 0);
  return d;
}

export default function InlineEditCard({
  anchorRect,
  date,
  hour,
  minutes,
  editEvent,
  onClose,
  onSave,
  onExpandToModal,
  onDelete,
  onChange,
  previewStartMinutes,
  previewEndMinutes,
}: InlineEditCardProps) {
  const { createEvent, updateEvent, deleteEvent, respondToEvent } = useEventStore();
  const titleRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const isEdit = !!editEvent;
  const [responding, setResponding] = useState(false);
  const needsRsvp = isEdit && isPendingRsvp(editEvent.responseStatus);

  const handleRsvp = async (response: RsvpResponse) => {
    setResponding(true);
    try {
      await respondToEvent(editEvent!.id, response);
      onClose();
    } catch (err) {
      console.error(`Failed to RSVP (${response}):`, err);
      setResponding(false);
    }
  };

  const defaultStart = editEvent
    ? new Date(editEvent.startTime)
    : new Date(date!.getFullYear(), date!.getMonth(), date!.getDate(), hour!, minutes!);
  const defaultEnd = editEvent
    ? new Date(editEvent.endTime)
    : new Date(defaultStart.getTime() + 60 * 60 * 1000);

  const [title, setTitle] = useState(editEvent?.title ?? '');
  const [startTime, setStartTime] = useState(toTimeInputValue(defaultStart));
  const [endTime, setEndTime] = useState(toTimeInputValue(defaultEnd));
  const [color, setColor] = useState(editEvent?.color ?? '#003262');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const dateBase = editEvent ? new Date(editEvent.startTime) : date!;

  // Sync time inputs when preview is resized via drag
  useEffect(() => {
    if (previewStartMinutes != null) {
      const h = String(Math.floor(previewStartMinutes / 60)).padStart(2, '0');
      const m = String(previewStartMinutes % 60).padStart(2, '0');
      setStartTime(`${h}:${m}`);
    }
  }, [previewStartMinutes]);

  useEffect(() => {
    if (previewEndMinutes != null) {
      const h = String(Math.floor(previewEndMinutes / 60)).padStart(2, '0');
      const m = String(previewEndMinutes % 60).padStart(2, '0');
      setEndTime(`${h}:${m}`);
    }
  }, [previewEndMinutes]);

  useEffect(() => {
    // Small delay to let the card render before focusing
    const timer = setTimeout(() => titleRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const getStartDate = () => parseTimeInput(dateBase, startTime);
  const getEndDate = () => parseTimeInput(dateBase, endTime);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);

    const input = {
      title: title.trim(),
      startTime: getStartDate().toISOString(),
      endTime: getEndDate().toISOString(),
      color,
    };

    try {
      if (isEdit) {
        await updateEvent(editEvent.id, input);
      } else {
        await createEvent(input);
      }
      onSave();
    } catch (err) {
      console.error('Failed to save event:', err);
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  const handleExpandToModal = () => {
    onExpandToModal({
      title,
      startTime: getStartDate().toISOString(),
      endTime: getEndDate().toISOString(),
      color,
    });
  };

  const handleDelete = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await deleteEvent(editEvent!.id);
    onClose();
  };

  // Position: try right of anchor, fall back to left
  const cardWidth = 280;
  const cardHeight = 260;
  let left = anchorRect.right + 8;
  let top = anchorRect.top;

  if (left + cardWidth > window.innerWidth - 16) {
    left = anchorRect.left - cardWidth - 8;
  }
  if (top + cardHeight > window.innerHeight - 16) {
    top = window.innerHeight - cardHeight - 16;
  }
  if (top < 8) top = 8;

  return (
    <div
      ref={cardRef}
      className="fixed z-50 bg-card border border-border rounded-lg shadow-lg"
      style={{ left, top, width: cardWidth }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Color stripe */}
      <div className="h-1.5 rounded-t-lg" style={{ backgroundColor: color }} />

      <div className="p-3 space-y-2.5">
        {/* Title */}
        <input
          ref={titleRef}
          type="text"
          placeholder="Add title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            onChange?.({ title: e.target.value });
          }}
          onKeyDown={handleKeyDown}
          className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />

        {/* Time row */}
        <div className="flex items-center gap-2 text-xs">
          <input
            type="time"
            value={startTime}
            onChange={(e) => {
              setStartTime(e.target.value);
              const [h, m] = e.target.value.split(':').map(Number);
              onChange?.({ startMinutes: h * 60 + m });
            }}
            className="px-2 py-1 border border-border rounded-md bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="time"
            value={endTime}
            onChange={(e) => {
              setEndTime(e.target.value);
              const [h, m] = e.target.value.split(':').map(Number);
              onChange?.({ endMinutes: h * 60 + m });
            }}
            className="px-2 py-1 border border-border rounded-md bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Color dots */}
        <div className="flex items-center gap-1">
          {EVENT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="w-4 h-4 rounded-full border-2 transition-all shrink-0"
              style={{
                backgroundColor: c,
                borderColor: color === c ? '#000' : 'transparent',
                transform: color === c ? 'scale(1.15)' : undefined,
              }}
              onClick={() => {
                setColor(c);
                onChange?.({ color: c });
              }}
            />
          ))}
        </div>

        {/* RSVP buttons for pending Google Calendar events */}
        {needsRsvp && !confirming && (
          <div className="space-y-1.5">
            <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
              {editEvent.responseStatus === 'tentative' ? 'Tentatively accepted' : 'Pending invitation'}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                className="flex-1 text-xs h-7 gap-1"
                disabled={responding}
                onClick={() => handleRsvp('accepted')}
              >
                <Check className="w-3 h-3" />
                Accept
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs h-7 gap-1"
                disabled={responding}
                onClick={() => handleRsvp('tentative')}
              >
                <HelpCircle className="w-3 h-3" />
                Maybe
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs h-7 gap-1 hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
                disabled={responding}
                onClick={() => handleRsvp('declined')}
              >
                <X className="w-3 h-3" />
                Decline
              </Button>
            </div>
          </div>
        )}

        {/* Delete confirmation */}
        {confirming && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Are you sure you want to delete this event?</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs h-7"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="flex-1 text-xs h-7"
                onClick={handleDelete}
              >
                Delete
              </Button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {!confirming && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="text-xs h-7"
              disabled={saving || !title.trim()}
              onClick={handleSave}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={handleExpandToModal}
            >
              More options
            </Button>
            {isEdit && (
              <button
                className="ml-auto text-muted-foreground hover:text-destructive transition-colors"
                onClick={() => setConfirming(true)}
                title="Delete event"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
