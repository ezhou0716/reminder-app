import { getDb } from '../database';

// --- Manual completion (for non-submitted assignments) ---

export function isCompleted(assignmentId: string, source: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT 1 FROM completed_assignments WHERE assignment_id = ? AND source = ?')
    .get(assignmentId, source);
  return row !== undefined;
}

export function markCompleted(assignmentId: string, source: string): void {
  const db = getDb();
  db.prepare(
    'INSERT OR IGNORE INTO completed_assignments (assignment_id, source) VALUES (?, ?)',
  ).run(assignmentId, source);
}

export function unmarkCompleted(assignmentId: string, source: string): void {
  const db = getDb();
  db.prepare(
    'DELETE FROM completed_assignments WHERE assignment_id = ? AND source = ?',
  ).run(assignmentId, source);
}

// --- Dismissed submissions (user unchecked a submitted assignment) ---

export function isDismissed(assignmentId: string, source: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT 1 FROM dismissed_submissions WHERE assignment_id = ? AND source = ?')
    .get(assignmentId, source);
  return row !== undefined;
}

export function dismissSubmission(assignmentId: string, source: string): void {
  const db = getDb();
  db.prepare(
    'INSERT OR IGNORE INTO dismissed_submissions (assignment_id, source) VALUES (?, ?)',
  ).run(assignmentId, source);
}

export function undismissSubmission(assignmentId: string, source: string): void {
  const db = getDb();
  db.prepare(
    'DELETE FROM dismissed_submissions WHERE assignment_id = ? AND source = ?',
  ).run(assignmentId, source);
}

// --- Calendar entries (assignment → Google Calendar mapping) ---

export function isCalendarRemoved(assignmentId: string, source: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT removed FROM assignment_calendar_entries WHERE assignment_id = ? AND source = ?')
    .get(assignmentId, source) as { removed: number } | undefined;
  return row?.removed === 1;
}

export function getAllAssignmentGoogleEventIds(): string[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT google_event_id FROM assignment_calendar_entries WHERE google_event_id IS NOT NULL')
    .all() as { google_event_id: string }[];
  return rows.map((r) => r.google_event_id);
}

export function isAssignmentGoogleEvent(googleEventId: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT 1 FROM assignment_calendar_entries WHERE google_event_id = ?')
    .get(googleEventId);
  return row !== undefined;
}

export function getCalendarEntry(assignmentId: string, source: string): { googleEventId: string | null; removed: boolean } | null {
  const db = getDb();
  const row = db
    .prepare('SELECT google_event_id, removed FROM assignment_calendar_entries WHERE assignment_id = ? AND source = ?')
    .get(assignmentId, source) as { google_event_id: string | null; removed: number } | undefined;
  if (!row) return null;
  return { googleEventId: row.google_event_id, removed: row.removed === 1 };
}

export function upsertCalendarEntry(assignmentId: string, source: string, googleEventId: string | null): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO assignment_calendar_entries (assignment_id, source, google_event_id, removed)
    VALUES (?, ?, ?, 0)
    ON CONFLICT(assignment_id, source) DO UPDATE SET google_event_id = COALESCE(?, google_event_id), removed = 0
  `).run(assignmentId, source, googleEventId, googleEventId);
}

export function markCalendarRemoved(assignmentId: string, source: string): void {
  const db = getDb();
  db.prepare(
    'UPDATE assignment_calendar_entries SET removed = 1 WHERE assignment_id = ? AND source = ?',
  ).run(assignmentId, source);
}

export function markCalendarAdded(assignmentId: string, source: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO assignment_calendar_entries (assignment_id, source, removed)
    VALUES (?, ?, 0)
    ON CONFLICT(assignment_id, source) DO UPDATE SET removed = 0
  `).run(assignmentId, source);
}

// --- Unified toggle ---

/**
 * Toggle the "done" state of an assignment.
 * - Submitted assignments: toggle dismissed state
 * - Non-submitted assignments: toggle completed state
 * Returns { done, dismissed } representing the new effective state.
 */
export function toggleDone(
  assignmentId: string,
  source: string,
  isSubmitted: boolean,
): { done: boolean; dismissed: boolean; completed: boolean } {
  if (isSubmitted) {
    // Submitted assignment: toggle dismissed
    if (isDismissed(assignmentId, source)) {
      undismissSubmission(assignmentId, source);
      return { done: true, dismissed: false, completed: false };
    } else {
      dismissSubmission(assignmentId, source);
      return { done: false, dismissed: true, completed: false };
    }
  } else {
    // Non-submitted: toggle completed
    if (isCompleted(assignmentId, source)) {
      unmarkCompleted(assignmentId, source);
      return { done: false, dismissed: false, completed: false };
    } else {
      markCompleted(assignmentId, source);
      return { done: true, dismissed: false, completed: true };
    }
  }
}
