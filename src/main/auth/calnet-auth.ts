import { BrowserWindow } from 'electron';
import { saveCookies, type StoredCookie } from './cookie-store';

interface CalNetAuthOptions {
  url: string;
  cookieName: string; // 'bcourses' or 'gradescope'
  successUrlPattern: string; // URL pattern indicating successful auth
  calnetId: string;
  calnetPassphrase: string;
  preCalnetSteps?: (win: BrowserWindow) => Promise<void>;
}

export async function authenticateCalNet(options: CalNetAuthOptions): Promise<StoredCookie[]> {
  const { url, cookieName, successUrlPattern, calnetId, calnetPassphrase, preCalnetSteps } = options;

  return new Promise((resolve, reject) => {
    const authWindow = new BrowserWindow({
      width: 800,
      height: 700,
      title: 'CalNet Authentication',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    let resolved = false;
    let credentialsFilled = false;
    let passedThroughCalNet = false;
    // Track whether preCalnetSteps have finished so we don't
    // check success before the SAML school selection is done
    let preStepsDone = !preCalnetSteps;

    const finish = async (success: boolean) => {
      if (resolved) return;
      resolved = true;

      if (success) {
        try {
          await new Promise((r) => setTimeout(r, 2000));
          const electronCookies = await authWindow.webContents.session.cookies.get({});
          const cookies: StoredCookie[] = electronCookies.map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            httpOnly: c.httpOnly,
            secure: c.secure,
          }));
          saveCookies(cookieName, cookies);
          if (!authWindow.isDestroyed()) authWindow.destroy();
          resolve(cookies);
        } catch (err) {
          if (!authWindow.isDestroyed()) authWindow.destroy();
          reject(err);
        }
      } else {
        if (!authWindow.isDestroyed()) authWindow.destroy();
        reject(new Error('Authentication window was closed'));
      }
    };

    const handleUrl = (navUrl: string) => {
      if (resolved) return;
      console.log('[CalNet] Navigation:', navUrl);

      // Detect CalNet page (even if it redirects quickly when already signed in)
      if (navUrl.includes('auth.berkeley.edu') || navUrl.includes('calnet.berkeley.edu')) {
        passedThroughCalNet = true;

        if (!credentialsFilled) {
          credentialsFilled = true;
          setTimeout(async () => {
            if (authWindow.isDestroyed()) return;
            try {
              await authWindow.webContents.executeJavaScript(`
                (function() {
                  const username = document.getElementById('username');
                  const password = document.getElementById('password');
                  if (username && password) {
                    username.value = ${JSON.stringify(calnetId)};
                    password.value = ${JSON.stringify(calnetPassphrase)};
                    const submit = document.getElementById('submitBtn')
                      || document.querySelector('#fm1 input[type="submit"]')
                      || document.querySelector('#fm1 button[type="submit"]');
                    if (submit) submit.click();
                  }
                })();
              `);
            } catch (err) {
              console.error('[CalNet] Failed to auto-fill:', err);
            }
          }, 1000);
        }
        return;
      }

      // Success: redirected back to the target site after CalNet
      if (preStepsDone && passedThroughCalNet && navUrl.includes(successUrlPattern)) {
        finish(true);
      }
    };

    // Listen on multiple navigation events to catch all redirect types
    authWindow.webContents.on('did-navigate', (_event, navUrl) => handleUrl(navUrl));
    authWindow.webContents.on('will-navigate', (_event, navUrl) => handleUrl(navUrl));
    authWindow.webContents.on('did-redirect-navigation', (_event, navUrl) => handleUrl(navUrl));

    authWindow.on('closed', () => {
      finish(false);
    });

    authWindow.loadURL(url).then(async () => {
      if (preCalnetSteps) {
        try {
          await preCalnetSteps(authWindow);
        } catch (err) {
          console.error('[CalNet] Pre-CalNet steps failed:', err);
        }
        preStepsDone = true;
      }
    });
  });
}
