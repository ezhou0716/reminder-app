import { useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { X, ExternalLink, CheckCircle, Circle, Clock, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAssignmentStore } from '@/stores/assignment-store';
import { cn } from '@/lib/utils';
import type { Assignment } from '@shared/types/assignment';

interface AssignmentPopoverProps {
  assignment: Assignment;
  anchorRect: DOMRect;
  onClose: () => void;
}

export default function AssignmentPopover({ assignment, anchorRect, onClose }: AssignmentPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { toggleCompleted } = useAssignmentStore();

  const done =
    (assignment.submitted && !assignment.dismissed) || !!assignment.completed;

  const due = new Date(assignment.dueAt);
  const hoursLeft = (due.getTime() - Date.now()) / (1000 * 60 * 60);

  let urgencyLabel = '';
  let urgencyColor = '';
  if (done) {
    urgencyLabel = assignment.submitted ? 'Submitted' : 'Completed';
    urgencyColor = 'text-muted-foreground';
  } else if (hoursLeft < 0) {
    urgencyLabel = 'Past due';
    urgencyColor = 'text-destructive';
  } else if (hoursLeft < 3) {
    urgencyLabel = `Due in ${Math.max(1, Math.round(hoursLeft * 60))} min`;
    if (hoursLeft >= 1) urgencyLabel = `Due in ~${Math.round(hoursLeft)}h`;
    urgencyColor = 'text-destructive';
  } else if (hoursLeft < 24) {
    urgencyLabel = `Due in ~${Math.round(hoursLeft)}h`;
    urgencyColor = 'text-warning';
  }

  // Position: try to place to the right of the block, fall back to left
  const popoverWidth = 280;
  const popoverHeight = 220;
  let left = anchorRect.right + 8;
  let top = anchorRect.top;

  // If it overflows the right edge, place to the left
  if (left + popoverWidth > window.innerWidth - 16) {
    left = anchorRect.left - popoverWidth - 8;
  }
  // If it overflows the bottom, shift up
  if (top + popoverHeight > window.innerHeight - 16) {
    top = window.innerHeight - popoverHeight - 16;
  }
  // Clamp to top
  if (top < 8) top = 8;

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Delay to avoid the opening click from immediately closing
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-card border border-border rounded-lg shadow-lg"
      style={{ left, top, width: popoverWidth }}
    >
      {/* Header */}
      <div className="flex items-start justify-between p-3 pb-0">
        <div className="flex-1 min-w-0">
          <p className={cn('text-sm font-semibold leading-tight', done && 'line-through text-muted-foreground')}>
            {assignment.name}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{assignment.courseName}</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground ml-2 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Details */}
      <div className="px-3 pt-2 pb-1 space-y-1.5">
        <div className="flex items-center gap-2 text-xs">
          <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span>{format(due, 'EEEE, MMM d · h:mm a')}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <BookOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="capitalize">{assignment.source}</span>
        </div>
        {urgencyLabel && (
          <div className={cn('flex items-center gap-2 text-xs font-medium', urgencyColor)}>
            {done
              ? <CheckCircle className="w-3.5 h-3.5 shrink-0" />
              : <Circle className="w-3.5 h-3.5 shrink-0" />
            }
            <span>{urgencyLabel}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 p-3 pt-2">
        <Button
          variant={done ? 'outline' : 'default'}
          size="sm"
          className="flex-1 text-xs h-8"
          onClick={() => {
            toggleCompleted(assignment.id, assignment.source);
          }}
        >
          {done ? 'Mark incomplete' : 'Mark complete'}
        </Button>
        {assignment.url && (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs h-8 gap-1"
            onClick={() => window.electronAPI.openExternal(assignment.url)}
          >
            <ExternalLink className="w-3 h-3" />
            Open
          </Button>
        )}
      </div>
    </div>
  );
}
