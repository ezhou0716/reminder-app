import { Calendar, ListTodo, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isSameDay } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useCalendarStore } from '@/stores/calendar-store';
import { useAuthStore } from '@/stores/auth-store';
import AccountStatus from '@/components/auth/AccountStatus';
import { cn } from '@/lib/utils';

export default function Sidebar() {
  const { viewMode, setViewMode, currentDate } = useCalendarStore();

  return (
    <aside className="w-60 bg-sidebar border-r border-sidebar-border flex flex-col shrink-0">
      {/* Navigation */}
      <nav className="p-3 space-y-1">
        <SidebarItem
          icon={<Calendar className="w-4 h-4" />}
          label="Calendar"
          active={viewMode === 'week'}
          onClick={() => setViewMode('week')}
        />
        <SidebarItem
          icon={<ListTodo className="w-4 h-4" />}
          label="Assignments"
          active={viewMode === 'assignments'}
          onClick={() => setViewMode('assignments')}
        />
      </nav>

      <Separator />

      {/* Mini Calendar */}
      <div className="p-3">
        <MiniCalendar currentDate={currentDate} />
      </div>

      <div className="flex-1" />

      <Separator />

      {/* Account Status */}
      <div className="p-3">
        <AccountStatus />
      </div>
    </aside>
  );
}

function SidebarItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-sidebar-foreground hover:bg-accent',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function MiniCalendar({ currentDate }: { currentDate: Date }) {
  const [viewMonth, setViewMonth] = useState(currentDate);
  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground">
          {format(viewMonth, 'MMMM yyyy')}
        </span>
        <div className="flex gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() =>
              setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1))
            }
          >
            <ChevronLeft className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() =>
              setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1))
            }
          >
            <ChevronRight className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="text-[10px] text-muted-foreground py-1">
            {d}
          </div>
        ))}
        {days.map((day, i) => {
          const isCurrentMonth = isSameMonth(day, viewMonth);
          const isSelected = isSameDay(day, currentDate);
          const isToday = isSameDay(day, new Date());

          return (
            <div
              key={i}
              className={cn(
                'text-[11px] w-7 h-7 flex items-center justify-center rounded-full mx-auto',
                !isCurrentMonth && 'text-muted-foreground/40',
                isCurrentMonth && 'text-foreground',
                isToday && !isSelected && 'text-berkeley-blue font-bold',
                isSelected && 'bg-berkeley-blue text-white',
              )}
            >
              {format(day, 'd')}
            </div>
          );
        })}
      </div>
    </div>
  );
}
