import { useEffect } from 'react';
import { useAssignmentStore } from '@/stores/assignment-store';

export function useAssignments() {
  const store = useAssignmentStore();

  useEffect(() => {
    // Load initial assignments
    window.electronAPI.getAssignments().then((assignments) => {
      store.setAssignments(assignments);
    });

    // Listen for push updates from main process
    const unsubscribe = window.electronAPI.onAssignmentsUpdated((assignments) => {
      store.setAssignments(assignments);
    });

    return unsubscribe;
  }, []);

  return store;
}
