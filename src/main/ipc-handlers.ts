import { ipcMain } from 'electron';
import { toggleDone } from './db/repositories/assignments';
import {
  getEventsInRange,
  createEvent,
  updateEvent,
  deleteEvent as deleteEventFromDb,
} from './db/repositories/events';
import { checkAndNotify, getCachedAssignments } from './scheduler/assignment-checker';
import { cookiesValid as canvasCookiesValid, loginViaCalNet as canvasLogin } from './clients/canvas-client';
import { cookiesValid as gradescopeCookiesValid, loginViaCalNet as gradescopeLogin } from './clients/gradescope-client';
import { authenticateGoogle, isGoogleAuthenticated, logoutGoogle } from './auth/google-auth';
import { fullSync } from './clients/google-calendar-client';
import { getMainWindow } from './windows';

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
    deleteEventFromDb(id);
    broadcastEventsUpdated();
    // Note: for Google events, a proper implementation would also delete from Google.
    // For now, the next sync will handle reconciliation.
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
