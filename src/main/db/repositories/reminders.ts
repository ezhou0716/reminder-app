import { getDb } from '../database';

export function wasReminderSent(
  assignmentId: string,
  source: string,
  threshold: string,
): boolean {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT 1 FROM sent_reminders WHERE assignment_id = ? AND source = ? AND threshold = ?',
    )
    .get(assignmentId, source, threshold);
  return row !== undefined;
}

export function markReminderSent(
  assignmentId: string,
  source: string,
  threshold: string,
): void {
  const db = getDb();
  db.prepare(
    'INSERT OR IGNORE INTO sent_reminders (assignment_id, source, threshold, sent_at) VALUES (?, ?, ?, ?)',
  ).run(assignmentId, source, threshold, new Date().toISOString());
}
