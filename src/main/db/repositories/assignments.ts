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
