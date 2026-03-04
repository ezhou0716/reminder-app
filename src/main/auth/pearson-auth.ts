import { BrowserWindow } from 'electron';
import { saveCookies, type StoredCookie } from './cookie-store';

// Standard Chrome user-agent to avoid CloudFront WAF blocking Electron's default UA
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let pearsonAuthActive = false;

export async function authenticatePearson(email: string, password: string): Promise<StoredCookie[]> {
  if (pearsonAuthActive) {
    throw new Error('Pearson auth window is already open');
  }
  pearsonAuthActive = true;

  return new Promise((resolve, reject) => {
    const authWindow = new BrowserWindow({
      width: 800,
      height: 700,
      title: 'Pearson Login',
      webPreferences: {
        partition: 'auth-pearson', // isolate from other auth flows
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    authWindow.webContents.setUserAgent(CHROME_UA);

    let resolved = false;
    let credentialsFilled = false;
    let loginPageLoaded = false; // only true when login page fully rendered

    authWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    const finish = async (success: boolean) => {
      if (resolved) return;
      resolved = true;
      pearsonAuthActive = false;

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
          saveCookies('pearson', cookies);
          if (!authWindow.isDestroyed()) authWindow.destroy();
          resolve(cookies);
        } catch (err) {
          if (!authWindow.isDestroyed()) authWindow.destroy();
          reject(err);
        }
      } else {
        if (!authWindow.isDestroyed()) authWindow.destroy();
        reject(new Error('Pearson authentication window was closed'));
      }
    };

    // Use did-finish-load exclusively — it only fires when a page fully loads,
    // NOT during intermediate hops in a 302 redirect chain. This prevents the
    // window from closing during a fast SSO bounce through login.pearson.com.
    authWindow.webContents.on('did-finish-load', async () => {
      if (resolved || authWindow.isDestroyed()) return;
      const url = authWindow.webContents.getURL();
      console.log('[Pearson] did-finish-load:', url);

      // Login page fully loaded — user needs to enter credentials
      if (url.includes('login.pearson.com')) {
        loginPageLoaded = true;

        if (!credentialsFilled && email && password) {
          credentialsFilled = true;
          setTimeout(async () => {
            if (authWindow.isDestroyed() || resolved) return;
            try {
              await authWindow.webContents.executeJavaScript(`
                (function() {
                  const emailInput = document.querySelector('input[type="email"]');
                  const passwordInput = document.querySelector('input[type="password"]');
                  if (emailInput) {
                    const nativeSetter = Object.getOwnPropertyDescriptor(
                      window.HTMLInputElement.prototype, 'value'
                    ).set;
                    nativeSetter.call(emailInput, ${JSON.stringify(email)});
                    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
                    emailInput.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                  if (passwordInput) {
                    const nativeSetter = Object.getOwnPropertyDescriptor(
                      window.HTMLInputElement.prototype, 'value'
                    ).set;
                    nativeSetter.call(passwordInput, ${JSON.stringify(password)});
                    passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
                    passwordInput.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                  const submit = document.querySelector('button[type="submit"]')
                    || document.querySelector('input[type="submit"]');
                  if (submit) submit.click();
                })();
              `);
            } catch (err) {
              console.error('[Pearson] Failed to auto-fill:', err);
            }
          }, 1500);
        }
        return;
      }

      // Dashboard loaded — verify the user is actually logged in
      if (url.includes('mycourses.pearson.com')) {
        if (!loginPageLoaded) {
          // We got to mycourses without the login page ever fully loading.
          // This means either SSO bounced us through, or session was already valid.
          // Verify by checking page content.
          try {
            const isLoggedIn: boolean = await authWindow.webContents.executeJavaScript(`
              document.body.innerText.includes('Sign Out') ||
              document.body.innerText.includes('My Courses')
            `);
            if (isLoggedIn) {
              console.log('[Pearson] Already logged in via existing session');
              finish(true);
            }
            // If not logged in, the page may do a client-side redirect to login
            // — did-finish-load will fire again for that page.
          } catch {
            // ignore
          }
        } else {
          // Login page was shown, user completed login, now at dashboard
          console.log('[Pearson] Login completed, reached dashboard');
          finish(true);
        }
      }
    });

    authWindow.on('closed', () => {
      finish(false);
    });

    // Start from mycourses — it will redirect to login.pearson.com naturally,
    // which avoids CloudFront blocking a direct hit to the login domain.
    authWindow.loadURL('https://mycourses.pearson.com');
  });
}
