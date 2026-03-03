import { useEffect } from 'react';
import { useEventStore } from '@/stores/event-store';
import { useCalendarStore } from '@/stores/calendar-store';

export function useEvents() {
  const store = useEventStore();
  const { weekStart, weekEnd } = useCalendarStore();

  const startTime = weekStart.toISOString();
  const endTime = weekEnd.toISOString();

  useEffect(() => {
    store.loadEvents(startTime, endTime);
  }, [startTime, endTime]);

  // Re-fetch when main process notifies of event changes
  useEffect(() => {
    const unsubEvents = window.electronAPI.onEventsUpdated(() => {
      store.loadEvents(startTime, endTime);
    });

    const unsubSync = window.electronAPI.onGoogleSyncStatus((status) => {
      store.setSyncing(status.syncing, status.error);
    });

    return () => {
      unsubEvents();
      unsubSync();
    };
  }, [startTime, endTime]);

  return store;
}
