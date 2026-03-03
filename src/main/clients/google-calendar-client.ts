import { refreshAccessToken } from '../auth/google-auth';
import {
  getDirtyEvents,
  markEventSynced,
  upsertGoogleEvent,
  deleteGoogleEvent,
  getSyncToken,
  setSyncToken,
} from '../db/repositories/events';

const BASE_URL = 'https://www.googleapis.com/calendar/v3';
const PRIMARY_CALENDAR = 'primary';

// Google Calendar color IDs → hex
const GOOGLE_COLOR_MAP: Record<string, string> = {
  '1': '#7986CB',  // Lavender
  '2': '#33B679',  // Sage
  '3': '#8E24AA',  // Grape
  '4': '#E67C73',  // Flamingo
  '5': '#F6BF26',  // Banana
  '6': '#F4511E',  // Tangerine
  '7': '#039BE5',  // Peacock
  '8': '#616161',  // Graphite
  '9': '#3F51B5',  // Blueberry
  '10': '#0B8043', // Basil
  '11': '#D50000', // Tomato
};

async function fetchCalendarAPI(path: string, options: RequestInit = {}): Promise<Response> {
  const accessToken = await refreshAccessToken();
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return response;
}

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  colorId?: string;
  etag?: string;
  status?: string;
}

interface GoogleEventsListResponse {
  items?: GoogleEvent[];
  nextSyncToken?: string;
  nextPageToken?: string;
}

function googleEventToLocal(ge: GoogleEvent, calendarId: string) {
  const allDay = !ge.start?.dateTime;
  let startTime: string;
  let endTime: string;

  if (allDay) {
    // All-day events: date field is YYYY-MM-DD, treat as midnight-to-midnight local
    startTime = new Date(ge.start?.date + 'T00:00:00').toISOString();
    endTime = new Date(ge.end?.date + 'T00:00:00').toISOString();
  } else {
    startTime = new Date(ge.start!.dateTime!).toISOString();
    endTime = new Date(ge.end!.dateTime!).toISOString();
  }

  return {
    googleEventId: ge.id,
    googleCalendarId: calendarId,
    title: ge.summary || '(No title)',
    description: ge.description,
    startTime,
    endTime,
    color: ge.colorId ? GOOGLE_COLOR_MAP[ge.colorId] : undefined,
    allDay,
    location: ge.location,
    etag: ge.etag,
  };
}

export async function syncFromGoogle(calendarId: string = PRIMARY_CALENDAR): Promise<void> {
  const syncToken = getSyncToken(calendarId);

  let url: string;
  if (syncToken) {
    // Incremental sync
    url = `/calendars/${encodeURIComponent(calendarId)}/events?syncToken=${encodeURIComponent(syncToken)}&maxResults=250&singleEvents=true`;
  } else {
    // Full sync: 6 months in each direction
    const now = new Date();
    const timeMin = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString();
    url = `/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=250&singleEvents=true`;
  }

  let pageToken: string | undefined;
  let newSyncToken: string | undefined;

  do {
    const fullUrl = pageToken ? `${url}&pageToken=${encodeURIComponent(pageToken)}` : url;
    const response = await fetchCalendarAPI(fullUrl);

    if (response.status === 410) {
      // Sync token expired — do a full re-sync
      console.log('[Google Calendar] Sync token expired, performing full sync');
      setSyncToken(calendarId, '');
      return syncFromGoogle(calendarId);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Calendar API error: ${response.status} ${text}`);
    }

    const data = await response.json() as GoogleEventsListResponse;

    for (const ge of data.items ?? []) {
      if (ge.status === 'cancelled') {
        deleteGoogleEvent(ge.id, calendarId);
      } else if (ge.start) {
        upsertGoogleEvent(googleEventToLocal(ge, calendarId));
      }
    }

    pageToken = data.nextPageToken;
    if (data.nextSyncToken) {
      newSyncToken = data.nextSyncToken;
    }
  } while (pageToken);

  if (newSyncToken) {
    setSyncToken(calendarId, newSyncToken);
  }
}

export async function pushToGoogle(calendarId: string = PRIMARY_CALENDAR): Promise<void> {
  const dirtyEvents = getDirtyEvents();

  for (const event of dirtyEvents) {
    const googleBody: Record<string, unknown> = {
      summary: event.title,
      description: event.description,
      location: event.location,
    };

    if (event.allDay) {
      // All-day: use date format YYYY-MM-DD
      googleBody.start = { date: event.startTime.slice(0, 10) };
      googleBody.end = { date: event.endTime.slice(0, 10) };
    } else {
      googleBody.start = { dateTime: event.startTime };
      googleBody.end = { dateTime: event.endTime };
    }

    try {
      let response: Response;

      if (event.googleEventId) {
        // Update existing Google event
        response = await fetchCalendarAPI(
          `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.googleEventId)}`,
          { method: 'PUT', body: JSON.stringify(googleBody) },
        );
      } else {
        // Create new Google event
        response = await fetchCalendarAPI(
          `/calendars/${encodeURIComponent(calendarId)}/events`,
          { method: 'POST', body: JSON.stringify(googleBody) },
        );
      }

      if (!response.ok) {
        console.error(`[Google Calendar] Push failed for event ${event.id}: ${response.status}`);
        continue;
      }

      const result = await response.json() as GoogleEvent;
      markEventSynced(event.id, result.id, calendarId, result.etag ?? '');
    } catch (err) {
      console.error(`[Google Calendar] Push error for event ${event.id}:`, err);
    }
  }
}

export async function fullSync(calendarId: string = PRIMARY_CALENDAR): Promise<void> {
  // Push local changes first, then pull from Google
  await pushToGoogle(calendarId);
  await syncFromGoogle(calendarId);
}
