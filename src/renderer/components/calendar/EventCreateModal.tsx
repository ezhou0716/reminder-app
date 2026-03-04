import { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { useEventStore } from '@/stores/event-store';
import type { CalendarEvent } from '@shared/types/event';

interface EventCreateModalProps {
  date: Date;
  hour: number;
  minutes: number;
  editEvent?: CalendarEvent;
  prefill?: { title: string; startTime: string; endTime: string; color: string };
  onClose: () => void;
}

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

function toLocalDateTimeString(d: Date): string {
  // Format as YYYY-MM-DDTHH:MM for datetime-local input
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

export default function EventCreateModal({ date, hour, minutes, editEvent, prefill, onClose }: EventCreateModalProps) {
  const { createEvent, updateEvent } = useEventStore();
  const titleRef = useRef<HTMLInputElement>(null);
  const isEdit = !!editEvent;

  const defaultStart = prefill
    ? new Date(prefill.startTime)
    : editEvent
      ? new Date(editEvent.startTime)
      : new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minutes);
  const defaultEnd = prefill
    ? new Date(prefill.endTime)
    : editEvent
      ? new Date(editEvent.endTime)
      : new Date(defaultStart.getTime() + 60 * 60 * 1000); // +1 hour

  const [title, setTitle] = useState(prefill?.title ?? editEvent?.title ?? '');
  const [startTime, setStartTime] = useState(toLocalDateTimeString(defaultStart));
  const [endTime, setEndTime] = useState(toLocalDateTimeString(defaultEnd));
  const [location, setLocation] = useState(editEvent?.location ?? '');
  const [description, setDescription] = useState(editEvent?.description ?? '');
  const [color, setColor] = useState(prefill?.color ?? editEvent?.color ?? '#003262');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);

    const input = {
      title: title.trim(),
      description: description.trim() || undefined,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      location: location.trim() || undefined,
      color,
    };

    try {
      if (isEdit) {
        await updateEvent(editEvent.id, input);
      } else {
        await createEvent(input);
      }
      onClose();
    } catch (err) {
      console.error('Failed to save event:', err);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-[400px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          <div className="p-4 space-y-3">
            <h2 className="text-sm font-semibold">{isEdit ? 'Edit Event' : 'New Event'}</h2>

            <input
              ref={titleRef}
              type="text"
              placeholder="Event title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />

            <div className="flex items-center gap-1.5">
              {EVENT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="w-5 h-5 rounded-full border-2 transition-all shrink-0"
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? '#000' : 'transparent',
                    transform: color === c ? 'scale(1.15)' : undefined,
                  }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Start</span>
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">End</span>
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </label>
            </div>

            <input
              type="text"
              placeholder="Location (optional)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />

            <textarea
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="flex justify-end gap-2 px-4 pb-4">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || !title.trim()}>
              {saving ? 'Saving...' : isEdit ? 'Save' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
