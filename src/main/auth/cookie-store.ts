import { app } from 'electron';
import path from 'path';
import fs from 'fs';

function getCookiePath(name: string): string {
  return path.join(app.getPath('userData'), `${name}_cookies.json`);
}

export interface StoredCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
}

export function saveCookies(name: string, cookies: StoredCookie[]): void {
  const filePath = getCookiePath(name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2));
}

export function loadCookies(name: string): StoredCookie[] | null {
  const filePath = getCookiePath(name);
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function clearCookies(name: string): void {
  const filePath = getCookiePath(name);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function cookieHeader(cookies: StoredCookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
