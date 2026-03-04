import { BrowserWindow } from 'electron';
import { randomBytes, createHash } from 'crypto';
import { saveGoogleTokens, getGoogleTokens, clearGoogleTokens, type GoogleTokens } from '../db/repositories/events';

const REDIRECT_URI = 'http://localhost:8914/oauth2callback';
const SCOPES = 'https://www.googleapis.com/auth/calendar';

function getClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error('GOOGLE_CLIENT_ID not set in .env');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error('GOOGLE_CLIENT_SECRET not set in .env');
  return secret;
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

let googleAuthActive = false;

export async function authenticateGoogle(): Promise<boolean> {
  if (googleAuthActive) return false;
  googleAuthActive = true;

  const clientId = getClientId();
  const { verifier, challenge } = generatePKCE();

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return new Promise((resolve) => {
    const authWindow = new BrowserWindow({
      width: 600,
      height: 700,
      title: 'Sign in with Google',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    let resolved = false;

    // Block popups from the auth page opening in system browser
    authWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    const finish = (success: boolean) => {
      if (resolved) return;
      resolved = true;
      googleAuthActive = false;
      if (!authWindow.isDestroyed()) authWindow.destroy();
      resolve(success);
    };

    const handleNavigation = async (url: string) => {
      if (resolved) return;
      if (!url.startsWith(REDIRECT_URI)) return;

      const parsed = new URL(url);
      const code = parsed.searchParams.get('code');
      const error = parsed.searchParams.get('error');

      if (error || !code) {
        console.error('[Google Auth] Error:', error);
        finish(false);
        return;
      }

      try {
        const tokens = await exchangeCodeForTokens(code, verifier);
        saveGoogleTokens(tokens);
        finish(true);
      } catch (err) {
        console.error('[Google Auth] Token exchange failed:', err);
        finish(false);
      }
    };

    authWindow.webContents.on('will-navigate', (_event, url) => handleNavigation(url));
    authWindow.webContents.on('did-navigate', (_event, url) => handleNavigation(url));
    authWindow.webContents.on('did-redirect-navigation', (_event, url) => handleNavigation(url));

    authWindow.on('closed', () => finish(false));

    authWindow.loadURL(authUrl.toString());
  });
}

async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<GoogleTokens> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  const data = await response.json() as { access_token: string; refresh_token: string; expires_in: number; scope?: string };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiryDate: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  };
}

export async function refreshAccessToken(): Promise<string> {
  const tokens = getGoogleTokens();
  if (!tokens) throw new Error('No Google tokens stored');

  // Return existing token if still valid (5-min buffer)
  if (tokens.expiryDate > Date.now() + 5 * 60 * 1000) {
    return tokens.accessToken;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${text}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number; scope?: string };
  const updated: GoogleTokens = {
    accessToken: data.access_token,
    refreshToken: tokens.refreshToken, // refresh token doesn't change
    expiryDate: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? tokens.scope,
  };
  saveGoogleTokens(updated);
  return updated.accessToken;
}

export function isGoogleAuthenticated(): boolean {
  return getGoogleTokens() !== null;
}

export function logoutGoogle(): void {
  clearGoogleTokens();
}
