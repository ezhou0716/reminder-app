import { useState } from 'react';
import { ExternalLink, CalendarMinus, CalendarPlus } from 'lucide-react';
import { useAssignmentStore } from '@/stores/assignment-store';
import { formatDueDate, hoursUntil } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';

export default function AssignmentList() {
  const { assignments, toggleCompleted, removeFromCalendar, addToCalendar, loading, pendingCalendarOps } = useAssignmentStore();
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);

  const sorted = [...assignments].sort((a, b) => {
    const aDone = (a.submitted && !a.dismissed) || !!a.completed;
    const bDone = (b.submitted && !b.dismissed) || !!b.completed;
    if (aDone !== bDone) return aDone ? 1 : -1;
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  });

  if (loading && assignments.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Loading assignments...
      </div>
    );
  }

  if (assignments.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        No upcoming assignments
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <table className="w-full">
        <thead className="sticky top-0 bg-background z-10">
          <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wider">
            <th className="w-10 py-3 px-3 text-center">{'\u2713'}</th>
            <th className="py-3 px-3">Course</th>
            <th className="py-3 px-3">Assignment</th>
            <th className="py-3 px-3">Due Date</th>
            <th className="py-3 px-3 w-24">Source</th>
            <th className="w-20 py-3 px-3"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((assignment) => {
            const done =
              (assignment.submitted && !assignment.dismissed) || !!assignment.completed;
            const hours = hoursUntil(assignment.dueAt);
            const isUrgent = !done && hours < 3;
            const isWarning = !done && hours >= 3 && hours < 24;
            const key = `${assignment.source}-${assignment.id}`;
            const isConfirming = confirmingRemove === key;
            const isPending = pendingCalendarOps.has(key);

            return (
              <tr
                key={key}
                className={cn(
                  'border-b border-border/50 transition-colors hover:bg-muted/50',
                  done && 'opacity-60',
                )}
                onDoubleClick={() => {
                  if (assignment.url) {
                    window.electronAPI.openExternal(assignment.url);
                  }
                }}
              >
                <td className="py-2.5 px-3 text-center" onDoubleClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => toggleCompleted(assignment.id, assignment.source)}
                    className="text-lg leading-none"
                  >
                    {done ? '\u2611' : '\u2610'}
                  </button>
                </td>
                <td
                  className={cn(
                    'py-2.5 px-3 text-sm',
                    done && 'line-through text-muted-foreground',
                    isUrgent && 'text-urgent font-medium',
                    isWarning && 'text-warning font-medium',
                  )}
                >
                  {assignment.courseName}
                </td>
                <td
                  className={cn(
                    'py-2.5 px-3 text-sm',
                    done && 'line-through text-muted-foreground',
                    isUrgent && 'text-urgent font-medium',
                    isWarning && 'text-warning font-medium',
                  )}
                >
                  {assignment.name}
                </td>
                <td
                  className={cn(
                    'py-2.5 px-3 text-sm',
                    done && 'line-through text-muted-foreground',
                    isUrgent && 'text-urgent font-medium',
                    isWarning && 'text-warning font-medium',
                  )}
                >
                  {formatDueDate(assignment.dueAt)}
                </td>
                <td className="py-2.5 px-3 text-sm text-muted-foreground capitalize">
                  {assignment.source}
                </td>
                <td className="py-2.5 px-3" onDoubleClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1 justify-end">
                    {assignment.url && (
                      <button
                        onClick={() => window.electronAPI.openExternal(assignment.url)}
                        className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                        title="Open in browser"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {assignment.calendarRemoved ? (
                      <button
                        onClick={() => addToCalendar(assignment.id, assignment.source)}
                        disabled={isPending}
                        className={cn(
                          'text-muted-foreground transition-colors p-0.5',
                          isPending ? 'opacity-50 cursor-not-allowed' : 'hover:text-foreground',
                        )}
                        title="Add to calendar"
                      >
                        <CalendarPlus className="w-3.5 h-3.5" />
                      </button>
                    ) : isConfirming ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-5 text-[10px] px-1.5"
                          onClick={() => {
                            removeFromCalendar(assignment.id, assignment.source);
                            setConfirmingRemove(null);
                          }}
                        >
                          Remove
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-5 text-[10px] px-1.5"
                          onClick={() => setConfirmingRemove(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmingRemove(key)}
                        disabled={isPending}
                        className={cn(
                          'text-muted-foreground transition-colors p-0.5',
                          isPending ? 'opacity-50 cursor-not-allowed' : 'hover:text-foreground',
                        )}
                        title="Remove from calendar"
                      >
                        <CalendarMinus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollArea>
  );
}
