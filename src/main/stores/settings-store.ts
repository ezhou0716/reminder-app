import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

let settingsFile: string | null = null;

function getSettingsFile(): string {
  if (!settingsFile) {
    settingsFile = join(app.getPath('userData'), 'ai-settings.json');
  }
  return settingsFile;
}

function readSettings(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(getSettingsFile(), 'utf-8'));
  } catch {
    return {};
  }
}

function writeSettings(data: Record<string, string>): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
  } catch {}
  writeFileSync(getSettingsFile(), JSON.stringify(data), 'utf-8');
}

export async function getApiKey(): Promise<string | null> {
  return readSettings()['gemini-api-key'] ?? null;
}

export async function setApiKey(key: string): Promise<void> {
  const settings = readSettings();
  settings['gemini-api-key'] = key;
  writeSettings(settings);
}

export async function hasApiKey(): Promise<boolean> {
  return !!readSettings()['gemini-api-key'];
}

export async function clearApiKey(): Promise<void> {
  const settings = readSettings();
  delete settings['gemini-api-key'];
  writeSettings(settings);
}
