export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  color?: string;
  allDay?: boolean;
  location?: string;
  googleEventId?: string;
  googleCalendarId?: string;
  etag?: string;
  source: 'local' | 'google';
  lastSyncedAt?: string;
  dirty?: boolean;
}

export interface CalendarEventInput {
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  color?: string;
  allDay?: boolean;
  location?: string;
}
