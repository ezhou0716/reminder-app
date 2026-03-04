import { ChevronLeft, ChevronRight, RefreshCw, RefreshCcw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCalendarStore } from '@/stores/calendar-store';
import { useAssignmentStore } from '@/stores/assignment-store';
import { useEventStore } from '@/stores/event-store';
import { useAuthStore } from '@/stores/auth-store';
import { useChatStore } from '@/stores/chat-store';
import { formatWeekRange } from '@/lib/date-utils';

export default function Header() {
  const { currentDate, goToToday, goNextWeek, goPrevWeek, viewMode } = useCalendarStore();
  const { refresh, loading } = useAssignmentStore();
  const { syncing, syncGoogle } = useEventStore();
  const { googleConnected } = useAuthStore();
  const { togglePanel, panelOpen } = useChatStore();

  return (
    <header className="h-12 border-b border-border flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={goToToday}>
          Today
        </Button>

        {viewMode === 'week' && (
          <>
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goPrevWeek}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goNextWeek}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            <h1 className="text-base font-semibold text-foreground">
              {formatWeekRange(currentDate)}
            </h1>
          </>
        )}

        {viewMode === 'assignments' && (
          <h1 className="text-base font-semibold text-foreground">Assignments</h1>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant={panelOpen ? 'default' : 'ghost'}
          size="sm"
          onClick={togglePanel}
          className="gap-1.5"
        >
          <Sparkles className="w-3.5 h-3.5" />
          AI
        </Button>
        {googleConnected && (
          <Button
            variant="ghost"
            size="sm"
            onClick={syncGoogle}
            disabled={syncing}
            className="gap-1.5"
          >
            <RefreshCcw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={loading}
          className="gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
    </header>
  );
}
