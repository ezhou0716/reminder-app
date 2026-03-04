import type { Assignment } from './assignment';
import type { CalendarEvent, CalendarEventInput } from './event';
import type { EventProposal, AiStreamChunk } from './ai';

export interface AuthStatus {
  canvas: boolean;
  gradescope: boolean;
  pearson: boolean;
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
  removeAssignmentFromCalendar: (id: string, source: string) => Promise<void>;
  addAssignmentToCalendar: (id: string, source: string) => Promise<void>;

  // Events
  getEvents: (startTime: string, endTime: string) => Promise<CalendarEvent[]>;
  createEvent: (input: CalendarEventInput) => Promise<CalendarEvent>;
  updateEvent: (id: string, input: Partial<CalendarEventInput>) => Promise<CalendarEvent>;
  deleteEvent: (id: string) => Promise<void>;

  // Auth
  getAuthStatus: () => Promise<AuthStatus>;
  loginCanvas: () => Promise<boolean>;
  loginGradescope: () => Promise<boolean>;
  loginPearson: () => Promise<boolean>;
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

  // AI
  aiSetApiKey: (key: string) => Promise<void>;
  aiHasApiKey: () => Promise<boolean>;
  aiClearApiKey: () => Promise<void>;
  aiSendMessage: (message: string, weekStart: string, weekEnd: string, filePaths?: string[]) => Promise<void>;
  aiClearConversation: () => Promise<void>;
  aiExecuteProposals: (proposals: EventProposal[]) => Promise<void>;
  onAiStreamChunk: (callback: (chunk: AiStreamChunk) => void) => () => void;

  // App
  openExternal: (url: string) => void;
  selectFiles: () => Promise<string[]>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
