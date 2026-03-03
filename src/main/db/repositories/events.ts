import { randomUUID } from 'crypto';
import { getDb } from '../database';
import type { CalendarEvent, CalendarEventInput } from '../../../shared/types/event';

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  color: string | null;
  all_day: number;
  location: string | null;
  google_event_id: string | null;
  google_calendar_id: string | null;
  etag: string | null;
  source: string;
  last_synced_at: string | null;
  dirty: number;
  created_at: string;
  updated_at: string;
}

function rowToEvent(row: EventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    startTime: row.start_time,
    endTime: row.end_time,
    color: row.color ?? undefined,
    allDay: row.all_day === 1,
    location: row.location ?? undefined,
    googleEventId: row.google_event_id ?? undefined,
    googleCalendarId: row.google_calendar_id ?? undefined,
    etag: row.etag ?? undefined,
    source: row.source as 'local' | 'google',
    lastSyncedAt: row.last_synced_at ?? undefined,
    dirty: row.dirty === 1,
  };
}

// --- CRUD ---

export function getEventsInRange(startTime: string, endTime: string): CalendarEvent[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM events WHERE end_time > ? AND start_time < ? ORDER BY start_time')
    .all(startTime, endTime) as EventRow[];
  return rows.map(rowToEvent);
}

export function getEventById(id: string): CalendarEvent | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined;
  return row ? rowToEvent(row) : null;
}

export function createEvent(input: CalendarEventInput): CalendarEvent {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO events (id, title, description, start_time, end_time, color, all_day, location, source, dirty, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'local', 1, ?, ?)
  `).run(id, input.title, input.description ?? null, input.startTime, input.endTime, input.color ?? null, input.allDay ? 1 : 0, input.location ?? null, now, now);

  return getEventById(id)!;
}

export function updateEvent(id: string, input: Partial<CalendarEventInput>): CalendarEvent | null {
  const db = getDb();
  const existing = getEventById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE events SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      start_time = COALESCE(?, start_time),
      end_time = COALESCE(?, end_time),
      color = COALESCE(?, color),
      all_day = COALESCE(?, all_day),
      location = COALESCE(?, location),
      dirty = 1,
      updated_at = ?
    WHERE id = ?
  `).run(
    input.title ?? null,
    input.description !== undefined ? (input.description ?? null) : null,
    input.startTime ?? null,
    input.endTime ?? null,
    input.color !== undefined ? (input.color ?? null) : null,
    input.allDay !== undefined ? (input.allDay ? 1 : 0) : null,
    input.location !== undefined ? (input.location ?? null) : null,
    now,
    id,
  );

  return getEventById(id);
}

export function deleteEvent(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM events WHERE id = ?').run(id);
  return result.changes > 0;
}

// --- Sync helpers ---

export function getDirtyEvents(): CalendarEvent[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM events WHERE dirty = 1').all() as EventRow[];
  return rows.map(rowToEvent);
}

export function markEventSynced(id: string, googleEventId: string, googleCalendarId: string, etag: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE events SET google_event_id = ?, google_calendar_id = ?, etag = ?, dirty = 0, last_synced_at = ?, updated_at = ?
    WHERE id = ?
  `).run(googleEventId, googleCalendarId, etag, now, now, id);
}

export function upsertGoogleEvent(event: {
  googleEventId: string;
  googleCalendarId: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  color?: string;
  allDay?: boolean;
  location?: string;
  etag?: string;
}): CalendarEvent {
  const db = getDb();
  const now = new Date().toISOString();

  // Check if we already have this Google event
  const existing = db
    .prepare('SELECT id FROM events WHERE google_event_id = ? AND google_calendar_id = ?')
    .get(event.googleEventId, event.googleCalendarId) as { id: string } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE events SET
        title = ?, description = ?, start_time = ?, end_time = ?, color = ?,
        all_day = ?, location = ?, etag = ?, dirty = 0, last_synced_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      event.title, event.description ?? null, event.startTime, event.endTime, event.color ?? null,
      event.allDay ? 1 : 0, event.location ?? null, event.etag ?? null, now, now,
      existing.id,
    );
    return getEventById(existing.id)!;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO events (id, title, description, start_time, end_time, color, all_day, location,
      google_event_id, google_calendar_id, etag, source, dirty, last_synced_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'google', 0, ?, ?, ?)
  `).run(
    id, event.title, event.description ?? null, event.startTime, event.endTime, event.color ?? null,
    event.allDay ? 1 : 0, event.location ?? null,
    event.googleEventId, event.googleCalendarId, event.etag ?? null, now, now, now,
  );
  return getEventById(id)!;
}

export function deleteGoogleEvent(googleEventId: string, googleCalendarId: string): boolean {
  const db = getDb();
  const result = db
    .prepare('DELETE FROM events WHERE google_event_id = ? AND google_calendar_id = ?')
    .run(googleEventId, googleCalendarId);
  return result.changes > 0;
}

// --- Sync state ---

export function getSyncToken(calendarId: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT sync_token FROM google_sync_state WHERE calendar_id = ?').get(calendarId) as { sync_token: string | null } | undefined;
  return row?.sync_token ?? null;
}

export function setSyncToken(calendarId: string, syncToken: string): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO google_sync_state (calendar_id, sync_token, last_full_sync)
    VALUES (?, ?, datetime('now'))
  `).run(calendarId, syncToken);
}

// --- Google auth tokens ---

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  scope?: string;
}

export function saveGoogleTokens(tokens: GoogleTokens): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO google_auth_tokens (id, access_token, refresh_token, expiry_date, scope)
    VALUES (1, ?, ?, ?, ?)
  `).run(tokens.accessToken, tokens.refreshToken, tokens.expiryDate, tokens.scope ?? null);
}

export function getGoogleTokens(): GoogleTokens | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM google_auth_tokens WHERE id = 1').get() as {
    access_token: string;
    refresh_token: string;
    expiry_date: number;
    scope: string | null;
  } | undefined;
  if (!row) return null;
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiryDate: row.expiry_date,
    scope: row.scope ?? undefined,
  };
}

export function clearGoogleTokens(): void {
  const db = getDb();
  db.prepare('DELETE FROM google_auth_tokens WHERE id = 1').run();
  db.prepare('DELETE FROM google_sync_state').run();
}
