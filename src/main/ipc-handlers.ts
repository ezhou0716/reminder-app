import { ipcMain, dialog } from 'electron';
import { toggleDone, getCalendarEntry, markCalendarRemoved, markCalendarAdded, upsertCalendarEntry } from './db/repositories/assignments';
import {
  getEventsInRange,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent as deleteEventFromDb,
} from './db/repositories/events';
import { checkAndNotify, getCachedAssignments } from './scheduler/assignment-checker';
import { cookiesValid as canvasCookiesValid, loginViaCalNet as canvasLogin } from './clients/canvas-client';
import { cookiesValid as gradescopeCookiesValid, loginViaCalNet as gradescopeLogin } from './clients/gradescope-client';
import { authenticateGoogle, isGoogleAuthenticated, logoutGoogle } from './auth/google-auth';
import { fullSync, deleteFromGoogle, pushAssignmentToGoogle } from './clients/google-calendar-client';
import { getMainWindow } from './windows';
import { getApiKey, setApiKey, hasApiKey, clearApiKey } from './stores/settings-store';
import { sendMessage as aiSendMessage, executeProposals as aiExecuteProposals, clearConversation as aiClearConversation } from './clients/ai-client';
import type { EventProposal } from '../shared/types/ai';

function broadcastEventsUpdated(): void {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('events:updated');
  }
}

function broadcastSyncStatus(syncing: boolean, error?: string): void {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('google:syncStatus', { syncing, error });
  }
}

async function triggerGoogleSyncIfConnected(): Promise<void> {
  if (!isGoogleAuthenticated()) return;
  broadcastSyncStatus(true);
  try {
    await fullSync();
    broadcastEventsUpdated();
    broadcastSyncStatus(false);
  } catch (err) {
    console.error('[Google Sync] Background sync failed:', err);
    broadcastSyncStatus(false, String(err));
  }
}

export function registerIpcHandlers(): void {
  // --- Assignments ---

  ipcMain.handle('assignments:get', () => {
    return getCachedAssignments();
  });

  ipcMain.handle('assignments:refresh', async () => {
    return checkAndNotify();
  });

  ipcMain.handle('assignments:toggleCompleted', (_event, id: string, source: string) => {
    const cached = getCachedAssignments();
    const assignment = cached.find((a) => a.id === id && a.source === source);
    const isSubmitted = assignment?.submitted ?? false;

    const result = toggleDone(id, source, isSubmitted);

    if (assignment) {
      assignment.completed = result.completed;
      assignment.dismissed = result.dismissed;
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('assignments:updated', cached);
      }
    }

    return result.done;
  });

  // Remove assignment from calendar (and Google)
  ipcMain.handle('assignments:removeFromCalendar', async (_event, id: string, source: string) => {
    const entry = getCalendarEntry(id, source);
    if (entry?.googleEventId && isGoogleAuthenticated()) {
      await deleteFromGoogle(entry.googleEventId).catch(console.error);
    }
    markCalendarRemoved(id, source);

    // Update cached assignment and broadcast
    const cached = getCachedAssignments();
    const assignment = cached.find((a) => a.id === id && a.source === source);
    if (assignment) {
      assignment.calendarRemoved = true;
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('assignments:updated', cached);
      }
    }
  });

  // Add assignment back to calendar (and Google)
  ipcMain.handle('assignments:addToCalendar', async (_event, id: string, source: string) => {
    markCalendarAdded(id, source);

    const cached = getCachedAssignments();
    const assignment = cached.find((a) => a.id === id && a.source === source);

    // Push to Google if connected
    if (assignment && isGoogleAuthenticated()) {
      try {
        const googleEventId = await pushAssignmentToGoogle(assignment);
        if (googleEventId) {
          upsertCalendarEntry(id, source, googleEventId);
        }
      } catch (err) {
        console.error('[Google] Failed to re-push assignment:', err);
      }
    }

    if (assignment) {
      assignment.calendarRemoved = false;
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('assignments:updated', cached);
      }
    }
  });

  // --- Events CRUD ---

  ipcMain.handle('events:getRange', (_event, startTime: string, endTime: string) => {
    return getEventsInRange(startTime, endTime);
  });

  ipcMain.handle('events:create', async (_event, input) => {
    const created = createEvent(input);
    broadcastEventsUpdated();
    triggerGoogleSyncIfConnected();
    return created;
  });

  ipcMain.handle('events:update', async (_event, id: string, input) => {
    const updated = updateEvent(id, input);
    broadcastEventsUpdated();
    triggerGoogleSyncIfConnected();
    return updated;
  });

  ipcMain.handle('events:delete', async (_event, id: string) => {
    const existing = getEventById(id);
    if (existing?.googleEventId && isGoogleAuthenticated()) {
      await deleteFromGoogle(existing.googleEventId).catch(console.error);
    }
    deleteEventFromDb(id);
    broadcastEventsUpdated();
  });

  // --- Auth ---

  ipcMain.handle('auth:status', async () => {
    const [canvas, gradescope] = await Promise.all([
      canvasCookiesValid().catch(() => false),
      gradescopeCookiesValid().catch(() => false),
    ]);
    return { canvas, gradescope, google: isGoogleAuthenticated() };
  });

  ipcMain.handle('auth:loginCanvas', async () => {
    const success = await canvasLogin();
    if (success) {
      setTimeout(() => checkAndNotify().catch(console.error), 1000);
    }
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      const status = {
        canvas: success,
        gradescope: await gradescopeCookiesValid().catch(() => false),
        google: isGoogleAuthenticated(),
      };
      mainWindow.webContents.send('auth:statusChanged', status);
    }
    return success;
  });

  ipcMain.handle('auth:loginGradescope', async () => {
    const success = await gradescopeLogin();
    if (success) {
      setTimeout(() => checkAndNotify().catch(console.error), 1000);
    }
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      const status = {
        canvas: await canvasCookiesValid().catch(() => false),
        gradescope: success,
        google: isGoogleAuthenticated(),
      };
      mainWindow.webContents.send('auth:statusChanged', status);
    }
    return success;
  });

  // --- Google Auth ---

  ipcMain.handle('google:authenticate', async () => {
    try {
      const success = await authenticateGoogle();
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        const status = {
          canvas: await canvasCookiesValid().catch(() => false),
          gradescope: await gradescopeCookiesValid().catch(() => false),
          google: success,
        };
        mainWindow.webContents.send('auth:statusChanged', status);
      }
      if (success) {
        triggerGoogleSyncIfConnected();
      }
      return success;
    } catch (err) {
      console.error('[Google Auth] Failed:', err);
      return false;
    }
  });

  ipcMain.handle('google:logout', async () => {
    logoutGoogle();
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      const status = {
        canvas: await canvasCookiesValid().catch(() => false),
        gradescope: await gradescopeCookiesValid().catch(() => false),
        google: false,
      };
      mainWindow.webContents.send('auth:statusChanged', status);
    }
    broadcastEventsUpdated();
  });

  // --- AI ---

  ipcMain.handle('ai:setApiKey', async (_event, key: string) => {
    await setApiKey(key);
  });

  ipcMain.handle('ai:hasApiKey', async () => {
    return hasApiKey();
  });

  ipcMain.handle('ai:clearApiKey', async () => {
    await clearApiKey();
  });

  ipcMain.handle('ai:sendMessage', async (_event, message: string, weekStart: string, weekEnd: string, filePaths?: string[]) => {
    await aiSendMessage(message, weekStart, weekEnd, filePaths);
  });

  ipcMain.handle('ai:clearConversation', () => {
    aiClearConversation();
  });

  ipcMain.handle('ai:executeProposals', async (_event, proposals: EventProposal[]) => {
    await aiExecuteProposals(proposals);
  });

  // --- File picker ---

  ipcMain.handle('app:selectFiles', async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Supported Files', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'csv'] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });

  // --- Google Calendar Sync ---

  ipcMain.handle('google:sync', async () => {
    if (!isGoogleAuthenticated()) return;
    broadcastSyncStatus(true);
    try {
      await fullSync();
      broadcastEventsUpdated();
      broadcastSyncStatus(false);
    } catch (err) {
      console.error('[Google Sync] Manual sync failed:', err);
      broadcastSyncStatus(false, String(err));
      throw err;
    }
  });
}
