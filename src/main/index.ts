import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { createMainWindow, getMainWindow } from './windows';
import { initDatabase } from './db/database';
import { registerIpcHandlers } from './ipc-handlers';
import { startScheduler, stopScheduler } from './scheduler/assignment-checker';
import { isGoogleAuthenticated } from './auth/google-auth';
import { fullSync } from './clients/google-calendar-client';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env — check userData first (installed app), then project root (dev)
dotenv.config({ path: path.join(app.getPath('userData'), '.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });

let isQuitting = false;
let googleSyncInterval: ReturnType<typeof setInterval> | null = null;

app.on('before-quit', () => {
  isQuitting = true;
});

function startGoogleSyncScheduler(): void {
  // Initial sync 5 seconds after start
  setTimeout(() => {
    runGoogleSync();
  }, 5000);

  // Periodic sync every 5 minutes
  googleSyncInterval = setInterval(() => {
    runGoogleSync();
  }, 5 * 60 * 1000);
}

function stopGoogleSyncScheduler(): void {
  if (googleSyncInterval) {
    clearInterval(googleSyncInterval);
    googleSyncInterval = null;
  }
}

async function runGoogleSync(): Promise<void> {
  if (!isGoogleAuthenticated()) return;

  const mainWindow = getMainWindow();
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('google:syncStatus', { syncing: true });
    }
    await fullSync();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('events:updated');
      mainWindow.webContents.send('google:syncStatus', { syncing: false });
    }
  } catch (err) {
    console.error('[Google Sync] Periodic sync failed:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('google:syncStatus', { syncing: false, error: String(err) });
    }
  }
}

app.whenReady().then(() => {
  // Initialize database
  initDatabase();

  // Register IPC handlers
  registerIpcHandlers();

  // Window controls
  ipcMain.on('window:minimize', () => getMainWindow()?.minimize());
  ipcMain.on('window:maximize', () => {
    const win = getMainWindow();
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });
  ipcMain.on('window:close', () => {
    const win = getMainWindow();
    if (win) {
      win.hide();
    }
  });
  ipcMain.on('app:openExternal', (_event, url: string) => {
    shell.openExternal(url);
  });

  // Create main window
  const mainWindow = createMainWindow();

  // Hide to "tray" on close instead of quitting
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Start background assignment checker
  startScheduler();

  // Start Google Calendar periodic sync
  startGoogleSyncScheduler();
});

// macOS: re-create window when dock icon clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  } else {
    getMainWindow()?.show();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopScheduler();
    stopGoogleSyncScheduler();
    app.quit();
  }
});
