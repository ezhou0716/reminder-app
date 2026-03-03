import { Notification, shell } from 'electron';
import type { Assignment } from '../../shared/types/assignment';

export function sendReminder(
  assignment: Assignment,
  hoursRemaining: number,
  threshold: string,
): void {
  const isUrgent = threshold === '3h';
  const title = isUrgent
    ? `URGENT: Due in ~${Math.round(hoursRemaining)}h!`
    : `Due in ~${Math.round(hoursRemaining)} hours`;
  const body = `${assignment.courseName}\n${assignment.name}`;

  const notification = new Notification({
    title,
    body,
    urgency: isUrgent ? 'critical' : 'normal',
  });

  notification.on('click', () => {
    if (assignment.url) {
      shell.openExternal(assignment.url);
    }
  });

  notification.show();
}
