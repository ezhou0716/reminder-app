export type RsvpStatus = 'needsAction' | 'accepted' | 'tentative' | 'declined';
export type RsvpResponse = Exclude<RsvpStatus, 'needsAction'>;

export function isPendingRsvp(status?: RsvpStatus): boolean {
  return status === 'needsAction' || status === 'tentative';
}

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
  responseStatus?: RsvpStatus;
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
