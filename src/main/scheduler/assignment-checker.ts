import { getUpcomingAssignments as getCanvasAssignments } from '../clients/canvas-client';
import { getUpcomingAssignments as getGradescopeAssignments } from '../clients/gradescope-client';
import { isCompleted, isDismissed, isCalendarRemoved, getCalendarEntry, upsertCalendarEntry } from '../db/repositories/assignments';
import { wasReminderSent, markReminderSent } from '../db/repositories/reminders';
import { sendReminder } from './notifier';
import { getMainWindow } from '../windows';
import { isGoogleAuthenticated } from '../auth/google-auth';
import { pushAssignmentToGoogle } from '../clients/google-calendar-client';
import type { Assignment } from '../../shared/types/assignment';

const REMINDER_THRESHOLDS = [24, 3]; // hours
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

let intervalId: ReturnType<typeof setInterval> | null = null;
let cachedAssignments: Assignment[] = [];

export async function checkAndNotify(): Promise<Assignment[]> {
  console.log(`[${new Date().toLocaleTimeString()}] Checking for upcoming assignments...`);
  const now = new Date();
  const allAssignments: Assignment[] = [];

  // Fetch from Canvas
  try {
    const canvas = await getCanvasAssignments();
    console.log(`  Found ${canvas.length} upcoming Canvas assignment(s)`);
    allAssignments.push(...canvas);
  } catch (err) {
    console.error('  [Canvas] Error:', err);
  }

  // Fetch from Gradescope
  try {
    const gs = await getGradescopeAssignments();
    console.log(`  Found ${gs.length} upcoming Gradescope assignment(s)`);
    allAssignments.push(...gs);
  } catch (err) {
    console.error('  [Gradescope] Error:', err);
  }

  // Check each assignment against thresholds
  let notified = 0;
  for (const assignment of allAssignments) {
    const dismissed = isDismissed(assignment.id, assignment.source);
    const completed = isCompleted(assignment.id, assignment.source);
    const calRemoved = isCalendarRemoved(assignment.id, assignment.source);
    assignment.dismissed = dismissed;
    assignment.completed = completed;
    assignment.calendarRemoved = calRemoved;

    // Auto-create calendar entry for new assignments (if not already tracked)
    const entry = getCalendarEntry(assignment.id, assignment.source);
    if (!entry) {
      console.log(`  [Calendar] New assignment: ${assignment.courseName} - ${assignment.name}`);
      if (isGoogleAuthenticated()) {
        try {
          const googleEventId = await pushAssignmentToGoogle(assignment);
          console.log(`  [Calendar] Pushed to Google: ${googleEventId}`);
          upsertCalendarEntry(assignment.id, assignment.source, googleEventId);
        } catch (err) {
          console.error(`  [Google] Failed to push assignment ${assignment.name}:`, err);
          upsertCalendarEntry(assignment.id, assignment.source, null);
        }
      } else {
        upsertCalendarEntry(assignment.id, assignment.source, null);
      }
    }

    // Effective "done": (submitted && !dismissed) || completed
    const done = (assignment.submitted && !dismissed) || completed;
    if (done) continue;

    const hoursLeft = (new Date(assignment.dueAt).getTime() - now.getTime()) / (1000 * 60 * 60);

    for (const threshold of REMINDER_THRESHOLDS.sort((a, b) => a - b)) {
      const thresholdKey = `${threshold}h`;
      if (hoursLeft <= threshold) {
        if (!wasReminderSent(assignment.id, assignment.source, thresholdKey)) {
          sendReminder(assignment, hoursLeft, thresholdKey);
          markReminderSent(assignment.id, assignment.source, thresholdKey);
          console.log(`  Sent ${thresholdKey} reminder: ${assignment.courseName} - ${assignment.name}`);
          notified++;
        }
      }
    }
  }

  if (notified === 0) {
    console.log('  No new reminders to send.');
  }

  // Cache and push to renderer
  cachedAssignments = allAssignments;
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('assignments:updated', allAssignments);
  }

  return allAssignments;
}

export function getCachedAssignments(): Assignment[] {
  return cachedAssignments;
}

export function startScheduler(): void {
  // Run first check after a short delay to let the window load
  setTimeout(() => {
    checkAndNotify().catch(console.error);
  }, 3000);

  intervalId = setInterval(() => {
    checkAndNotify().catch(console.error);
  }, CHECK_INTERVAL_MS);
}

export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
