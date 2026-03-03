import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from '../shared/types/ipc';

const api: ElectronAPI = {
  // Assignments
  getAssignments: () => ipcRenderer.invoke('assignments:get'),
  refreshAssignments: () => ipcRenderer.invoke('assignments:refresh'),
  toggleCompleted: (id, source) => ipcRenderer.invoke('assignments:toggleCompleted', id, source),

  // Events
  getEvents: (startTime, endTime) => ipcRenderer.invoke('events:getRange', startTime, endTime),
  createEvent: (input) => ipcRenderer.invoke('events:create', input),
  updateEvent: (id, input) => ipcRenderer.invoke('events:update', id, input),
  deleteEvent: (id) => ipcRenderer.invoke('events:delete', id),

  // Auth
  getAuthStatus: () => ipcRenderer.invoke('auth:status'),
  loginCanvas: () => ipcRenderer.invoke('auth:loginCanvas'),
  loginGradescope: () => ipcRenderer.invoke('auth:loginGradescope'),
  loginGoogle: () => ipcRenderer.invoke('google:authenticate'),
  logoutGoogle: () => ipcRenderer.invoke('google:logout'),

  // Google Calendar sync
  syncGoogleCalendar: () => ipcRenderer.invoke('google:sync'),

  // Window controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  // Events from main
  onAssignmentsUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, assignments: unknown) => {
      callback(assignments as any);
    };
    ipcRenderer.on('assignments:updated', handler);
    return () => ipcRenderer.removeListener('assignments:updated', handler);
  },

  onAuthStatusChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, status: unknown) => {
      callback(status as any);
    };
    ipcRenderer.on('auth:statusChanged', handler);
    return () => ipcRenderer.removeListener('auth:statusChanged', handler);
  },

  onEventsUpdated: (callback) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('events:updated', handler);
    return () => ipcRenderer.removeListener('events:updated', handler);
  },

  onGoogleSyncStatus: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, status: unknown) => {
      callback(status as any);
    };
    ipcRenderer.on('google:syncStatus', handler);
    return () => ipcRenderer.removeListener('google:syncStatus', handler);
  },

  // App
  openExternal: (url) => ipcRenderer.send('app:openExternal', url),
};

contextBridge.exposeInMainWorld('electronAPI', api);
