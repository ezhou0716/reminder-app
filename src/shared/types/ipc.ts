import type { Assignment } from './assignment';
import type { CalendarEvent, CalendarEventInput } from './event';

export interface AuthStatus {
  canvas: boolean;
  gradescope: boolean;
  google: boolean;
}

export interface GoogleSyncStatus {
  syncing: boolean;
  error?: string;
}

export interface ElectronAPI {
  // Assignments
  getAssignments: () => Promise<Assignment[]>;
  refreshAssignments: () => Promise<Assignment[]>;
  toggleCompleted: (id: string, source: string) => Promise<boolean>;

  // Events
  getEvents: (startTime: string, endTime: string) => Promise<CalendarEvent[]>;
  createEvent: (input: CalendarEventInput) => Promise<CalendarEvent>;
  updateEvent: (id: string, input: Partial<CalendarEventInput>) => Promise<CalendarEvent>;
  deleteEvent: (id: string) => Promise<void>;

  // Auth
  getAuthStatus: () => Promise<AuthStatus>;
  loginCanvas: () => Promise<boolean>;
  loginGradescope: () => Promise<boolean>;
  loginGoogle: () => Promise<boolean>;
  logoutGoogle: () => Promise<void>;

  // Google Calendar sync
  syncGoogleCalendar: () => Promise<void>;

  // Window controls
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;

  // Events from main process
  onAssignmentsUpdated: (callback: (assignments: Assignment[]) => void) => () => void;
  onAuthStatusChanged: (callback: (status: AuthStatus) => void) => () => void;
  onEventsUpdated: (callback: () => void) => () => void;
  onGoogleSyncStatus: (callback: (status: GoogleSyncStatus) => void) => () => void;

  // App
  openExternal: (url: string) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
