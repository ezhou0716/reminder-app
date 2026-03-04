import TitleBar from '@/components/layout/TitleBar';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import WeekView from '@/components/calendar/WeekView';
import AssignmentList from '@/components/assignments/AssignmentList';
import ChatPanel from '@/components/chat/ChatPanel';
import { useCalendarStore } from '@/stores/calendar-store';
import { useAssignments } from '@/hooks/useAssignments';
import { useEvents } from '@/hooks/useEvents';
import { useChat } from '@/hooks/useChat';

export default function App() {
  const { viewMode } = useCalendarStore();
  useAssignments();
  useEvents();
  useChat();

  return (
    <div className="h-screen flex flex-col bg-background">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          <Header />
          {viewMode === 'week' && <WeekView />}
          {viewMode === 'assignments' && <AssignmentList />}
        </main>
        <ChatPanel />
      </div>
    </div>
  );
}
