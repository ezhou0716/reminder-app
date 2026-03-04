import { BrowserWindow } from 'electron';
import { loadCookies, cookieHeader, type StoredCookie } from '../auth/cookie-store';
import { authenticatePearson } from '../auth/pearson-auth';
import type { Assignment } from '../../shared/types/assignment';

const PEARSON_DASHBOARD = 'https://mycourses.pearson.com/course-home#/tab/active';
const LOOKAHEAD_HOURS = 168;
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Prevent concurrent scraper instances (scheduler fires every 30 min + on startup)
let scrapeInProgress = false;

function isAuthUrl(url: string): boolean {
  return (
    url.includes('login.') ||
    url.includes('duosecurity') ||
    url.includes('microsoftonline') ||
    url.includes('sso.') ||
    url.includes('auth.') ||
    url.includes('idp.') ||
    url.includes('signin')
  );
}

function getCredentials(): { email: string; password: string } {
  return {
    email: process.env.PEARSON_EMAIL || '',
    password: process.env.PEARSON_PASSWORD || '',
  };
}

export async function cookiesValid(): Promise<boolean> {
  const cookies = loadCookies('pearson');
  if (!cookies) return false;

  try {
    const resp = await fetch('https://mycourses.pearson.com', {
      headers: { 'User-Agent': CHROME_UA, Cookie: cookieHeader(cookies) },
      redirect: 'manual',
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

export async function loginViaPearson(): Promise<boolean> {
  const { email, password } = getCredentials();

  try {
    const cookies = await authenticatePearson(email, password);
    return cookies.length > 0;
  } catch (err) {
    console.error('[Pearson] Login failed:', err);
    return false;
  }
}

async function setCookiesOnSession(session: Electron.Session, cookies: StoredCookie[]): Promise<void> {
  for (const c of cookies) {
    try {
      await session.cookies.set({
        url: `https://${(c.domain || 'pearson.com').replace(/^\./, '')}${c.path || '/'}`,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        httpOnly: c.httpOnly,
        secure: c.secure,
      });
    } catch {
      // Some cookies may fail to set, that's OK
    }
  }
}

/** Polls the page until checkJs returns truthy or timeout. */
async function waitForContent(win: BrowserWindow, checkJs: string, timeout = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (win.isDestroyed()) return false;
    try {
      const found = await win.webContents.executeJavaScript(checkJs);
      if (found) return true;
    } catch { /* page not ready yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function parsePearsonDate(text: string): Date | null {
  const cleaned = text.trim();

  // MM/DD/YYYY HH:MM AM/PM (e.g., "03/06/2026 11:59 PM")
  const slashDate = cleaned.match(
    /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i,
  );
  if (slashDate) {
    const month = parseInt(slashDate[1]) - 1;
    const day = parseInt(slashDate[2]);
    const year = parseInt(slashDate[3]);
    let hour = parseInt(slashDate[4]);
    const minute = parseInt(slashDate[5]);
    const ampm = slashDate[6].toUpperCase();
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    return new Date(year, month, day, hour, minute);
  }

  // ISO 8601 fallback
  const iso = new Date(cleaned);
  if (!isNaN(iso.getTime())) return iso;

  return null;
}

export async function getUpcomingAssignments(): Promise<Assignment[]> {
  const cookies = loadCookies('pearson');
  if (!cookies || cookies.length === 0) return [];

  if (scrapeInProgress) {
    console.log('[Pearson] Scrape already in progress, skipping');
    return [];
  }
  scrapeInProgress = true;

  const now = new Date();
  const cutoff = new Date(now.getTime() + LOOKAHEAD_HOURS * 60 * 60 * 1000);
  const assignments: Assignment[] = [];

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      partition: 'pearson-scraper', // isolate from other sessions
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setUserAgent(CHROME_UA);

  // Capture popup URLs instead of just blocking — course cards may open new windows
  let capturedPopupUrl: string | null = null;
  win.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[Pearson] Popup intercepted:', url);
    capturedPopupUrl = url;
    return { action: 'deny' };
  });

  try {
    await setCookiesOnSession(win.webContents.session, cookies);

    // ── Step 1: Load dashboard (hash-based SPA) ──
    console.log('[Pearson] Loading dashboard...');
    await win.loadURL(PEARSON_DASHBOARD);

    // Wait for course cards to render — cards use <a href="#"> with JS click handlers,
    // so we look for text patterns that indicate course cards are present
    const hasCourses = await waitForContent(
      win,
      `(function() {
        const text = document.body.innerText || '';
        return (text.includes('My Courses') || text.includes('course-home')) &&
               document.querySelectorAll('a[href="#"]').length > 2;
      })()`,
    );

    const dashUrl = win.webContents.getURL();
    console.log('[Pearson] Dashboard URL:', dashUrl, '| courses found:', hasCourses);

    if (isAuthUrl(dashUrl)) {
      console.log('[Pearson] Dashboard redirected to auth — session expired');
      return assignments;
    }

    if (!hasCourses) {
      const debugInfo: string = await win.webContents.executeJavaScript(`
        JSON.stringify({
          url: location.href,
          title: document.title,
          bodySnippet: document.body.innerText.substring(0, 500),
        })
      `);
      console.log('[Pearson] Dashboard debug:', debugInfo);
      return assignments;
    }

    // ── Step 2: Dump DOM structure to find the actual course card elements ──
    const domInfo: { courseCards: Array<{ name: string; tag: string; classes: string; parentTag: string; parentClasses: string; index: number }> } =
      await win.webContents.executeJavaScript(`
        (function() {
          const courseCards = [];

          // Walk the DOM tree looking for elements whose text matches course-name patterns
          // (contains a semester like "Spring 2026" or "Fall 2025" with an instructor name)
          const semesterPattern = /(Spring|Fall|Summer|Winter)\\s+20\\d{2}/i;
          const allElements = document.querySelectorAll('*');

          for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            const text = el.textContent || '';
            // Must match a semester pattern and be a reasonable card size
            if (!semesterPattern.test(text)) continue;
            // Skip huge containers (body, main wrappers) — card text should be < 500 chars
            if (text.length > 500) continue;
            // Skip tiny elements (just the date text itself)
            if (text.length < 30) continue;

            courseCards.push({
              name: text.trim().replace(/\\s+/g, ' ').substring(0, 150),
              tag: el.tagName.toLowerCase(),
              classes: (el.className || '').toString().substring(0, 200),
              parentTag: el.parentElement ? el.parentElement.tagName.toLowerCase() : '',
              parentClasses: el.parentElement ? (el.parentElement.className || '').toString().substring(0, 200) : '',
              index: i,
            });
          }

          return { courseCards };
        })()
      `);

    console.log('[Pearson] DOM course card candidates:');
    for (const c of domInfo.courseCards) {
      console.log('  ', c.tag, '|', c.classes.substring(0, 60), '|', c.name.substring(0, 80));
    }

    // ── Step 3: For each course, click it using proper MouseEvent and detect navigation ──
    // Deduplicate cards by name — we want the smallest (most specific) element per course
    const seen = new Set<string>();
    const uniqueCourses: typeof domInfo.courseCards = [];
    // Sort by text length ascending so we pick the most specific element
    const sorted = [...domInfo.courseCards].sort((a, b) => a.name.length - b.name.length);
    for (const card of sorted) {
      // Extract a key from the course name (semester + first few words)
      const semMatch = card.name.match(/(Spring|Fall|Summer|Winter)\s+20\d{2}/i);
      const key = semMatch ? semMatch[0] : card.name.substring(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueCourses.push(card);
    }

    console.log('[Pearson] Unique courses to scrape:', uniqueCourses.length);

    for (let i = 0; i < uniqueCourses.length; i++) {
      const card = uniqueCourses[i];
      try {
        // Navigate back to dashboard first (except for the first course)
        if (i > 0) {
          await win.loadURL(PEARSON_DASHBOARD);
          await waitForContent(win, `document.body.innerText.includes('My Courses')`, 15000);
        }

        capturedPopupUrl = null;

        // Click the course card using a proper MouseEvent with coordinates
        // This is necessary because SPA frameworks often check event properties
        const cardLabel = card.name.substring(0, 60);
        console.log('[Pearson] Clicking course:', cardLabel);

        const clicked: boolean = await win.webContents.executeJavaScript(`
          (function() {
            const semesterPattern = /(Spring|Fall|Summer|Winter)\\s+20\\d{2}/i;
            const targetText = ${JSON.stringify(card.name.substring(0, 50))};
            const allElements = document.querySelectorAll('*');
            let target = null;

            for (const el of allElements) {
              const text = (el.textContent || '').trim().replace(/\\s+/g, ' ');
              if (text.length > 500 || text.length < 30) continue;
              if (!semesterPattern.test(text)) continue;
              if (text.substring(0, 50) === targetText) {
                target = el;
                break;
              }
            }

            if (!target) return false;

            // Find the best clickable element: walk up to find an <a> or element with click handler
            let clickTarget = target;
            let el = target;
            for (let depth = 0; depth < 5 && el; depth++) {
              if (el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.getAttribute('ng-click') || el.getAttribute('onclick')) {
                clickTarget = el;
                break;
              }
              // Also check if this element or its children have an <a> tag
              const innerLink = el.querySelector('a');
              if (innerLink) {
                clickTarget = innerLink;
                break;
              }
              el = el.parentElement;
            }

            // Dispatch a full mouse event sequence (mousedown → mouseup → click)
            const rect = clickTarget.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 };
            clickTarget.dispatchEvent(new MouseEvent('mousedown', opts));
            clickTarget.dispatchEvent(new MouseEvent('mouseup', opts));
            clickTarget.dispatchEvent(new MouseEvent('click', opts));
            return true;
          })()
        `);

        if (!clicked) {
          console.log('[Pearson] Could not find element to click for course', i);
          continue;
        }

        // Wait for navigation — the click should trigger either:
        // 1. window.open() → captured by setWindowOpenHandler
        // 2. window.location change → detected via getURL()
        // 3. SPA hash change → also detected via getURL()
        let courseUrl: string | null = null;

        // Poll for up to 8 seconds checking for navigation or popup
        for (let wait = 0; wait < 16; wait++) {
          await new Promise((r) => setTimeout(r, 500));
          if (win.isDestroyed()) break;

          const curUrl = win.webContents.getURL();
          if (curUrl.includes('mylabmastering')) {
            courseUrl = curUrl;
            console.log('[Pearson] Window navigated to:', courseUrl);
            break;
          }

          const popup = capturedPopupUrl as string | null;
          if (popup && popup.includes('mylabmastering')) {
            courseUrl = popup;
            console.log('[Pearson] Popup intercepted:', courseUrl);
            break;
          }
        }

        if (!courseUrl) {
          // Dump debug info about what happened
          const postClickDebug: string = await win.webContents.executeJavaScript(`
            JSON.stringify({
              url: location.href,
              title: document.title,
              bodySnippet: document.body.innerText.substring(0, 300),
            })
          `);
          console.log('[Pearson] Click did not navigate. Debug:', postClickDebug, '| popup:', capturedPopupUrl);
          continue;
        }

        // If course URL came from a popup, navigate to it in the main window
        if (!win.webContents.getURL().includes('mylabmastering')) {
          await win.loadURL(courseUrl);
        }

        // Check for auth redirect
        const coursePageUrl = win.webContents.getURL();
        if (isAuthUrl(coursePageUrl)) {
          console.log('[Pearson] Course page redirected to auth:', coursePageUrl, '— skipping');
          break;
        }

        // Wait for the course page to render
        const hasAssignments = await waitForContent(
          win,
          `document.body.innerText.includes('Assignments') || document.body.innerText.includes('Due')`,
          20000,
        );

        const postWaitUrl = win.webContents.getURL();
        if (isAuthUrl(postWaitUrl)) {
          console.log('[Pearson] Course redirected to auth after load:', postWaitUrl, '— skipping');
          break;
        }

        if (!hasAssignments) {
          console.log('[Pearson] No assignments section found on course page');
          continue;
        }

        // Extract course name from rendered page
        const courseName: string = await win.webContents.executeJavaScript(`
          (function() {
            const banner = document.querySelector('[class*="course-title"], [class*="courseName"], .banner-title, [class*="header"] h1, [class*="header"] h2');
            if (banner) return banner.textContent.trim().substring(0, 100);
            const h1 = document.querySelector('h1');
            if (h1 && h1.textContent.trim().length > 3) return h1.textContent.trim().substring(0, 100);
            return document.title || '';
          })()
        `);
        // Extract a clean name from card text (first line that looks like a course name)
        const fallbackName = card.name.split(/\s{2,}/).find(s => s.length > 5 && /[A-Z]/.test(s)) || card.name.substring(0, 80);
        const displayName = courseName || fallbackName;
        console.log('[Pearson] Course name:', displayName);

        // Extract course ID from URL
        const courseIdMatch = courseUrl.match(/\/courses\/(\d+)/);
        const courseId = courseIdMatch ? courseIdMatch[1] : '';

        // Extract assignments from the live DOM
        const rawAssignments: Array<{ name: string; url: string; date: string; section: string }> =
          await win.webContents.executeJavaScript(`
            (function() {
              const results = [];
              const datePattern = /\\d{1,2}\\/\\d{1,2}\\/\\d{4}\\s+\\d{1,2}:\\d{2}\\s*(?:AM|PM)/i;

              // Strategy 1: Look for table rows or list items with dates
              const rows = document.querySelectorAll('tr, li, [class*="assignment"], [class*="activity"], [class*="item"]');
              for (const row of rows) {
                const rowText = row.textContent || '';
                const dateMatch = rowText.match(datePattern);
                if (!dateMatch) continue;

                // Get the assignment name — try link first, then first significant text
                const link = row.querySelector('a[href]');
                let name = '';
                let url = '';
                if (link) {
                  name = link.textContent.trim();
                  url = link.href;
                }
                if (!name || name.length < 3) {
                  // Try to get name from the first meaningful text node
                  const spans = row.querySelectorAll('span, div, td, a');
                  for (const el of spans) {
                    const t = el.textContent.trim();
                    if (t.length > 3 && !t.match(datePattern) && !t.match(/^(Due|Completed|Past|Score|Status)/i)) {
                      name = t.split('\\n')[0].trim();
                      break;
                    }
                  }
                }
                if (!name || name.length < 3) continue;
                // Skip if this looks like a header/section label
                if (name.match(/^(Upcoming|Past Due|Completed|All |Assignments$)/i)) continue;

                // Determine section context
                let section = 'unknown';
                let prev = row.previousElementSibling;
                let steps = 0;
                while (prev && steps < 20) {
                  const t = prev.textContent || '';
                  if (t.includes('Upcoming'))    { section = 'upcoming';  break; }
                  if (t.includes('Past Due'))    { section = 'past_due';  break; }
                  if (t.includes('Completed'))   { section = 'completed'; break; }
                  prev = prev.previousElementSibling;
                  steps++;
                }
                // Also check parent containers for section context
                if (section === 'unknown') {
                  let parent = row.parentElement;
                  let pSteps = 0;
                  while (parent && pSteps < 5) {
                    const cls = (parent.className || '') + ' ' + (parent.getAttribute('aria-label') || '');
                    if (cls.match(/upcoming/i))   { section = 'upcoming';  break; }
                    if (cls.match(/past/i))       { section = 'past_due';  break; }
                    if (cls.match(/completed/i))  { section = 'completed'; break; }
                    parent = parent.parentElement;
                    pSteps++;
                  }
                }

                results.push({ name: name.substring(0, 150), url, date: dateMatch[0], section });
              }

              // Strategy 2: If no rows found, scan all text nodes for date patterns
              if (results.length === 0) {
                const allText = document.body.innerText;
                const lines = allText.split('\\n').filter(l => l.trim());
                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i];
                  const dateMatch = line.match(datePattern);
                  if (!dateMatch) continue;
                  // Look at previous lines for an assignment name
                  let name = '';
                  for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
                    const prev = lines[j].trim();
                    if (prev.length > 3 && !prev.match(datePattern) && !prev.match(/^(Due|Score|Status)/i)) {
                      name = prev.substring(0, 150);
                      break;
                    }
                  }
                  if (name) {
                    results.push({ name, url: '', date: dateMatch[0], section: 'unknown' });
                  }
                }
              }

              return results;
            })()
          `);

        console.log(
          '[Pearson] Assignments in "' + displayName + '":',
          rawAssignments.map((a) => `${a.name} | ${a.date} | ${a.section}`),
        );

        for (const raw of rawAssignments) {
          if (raw.section === 'completed') continue;

          const dueAt = parsePearsonDate(raw.date);
          if (!dueAt) continue;
          if (dueAt <= now || dueAt > cutoff) continue;

          const assignId = courseId
            ? `${courseId}_${raw.name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50)}`
            : raw.name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 60);

          assignments.push({
            id: `ps_${assignId}`,
            name: raw.name,
            courseName: displayName,
            dueAt: dueAt.toISOString(),
            url: raw.url || courseUrl,
            source: 'pearson',
            submitted: false,
          });
        }
      } catch (err) {
        console.error(`[Pearson] Error fetching course ${i}:`, err);
      }
    }
  } catch (err) {
    console.error('[Pearson] Error:', err);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    scrapeInProgress = false;
  }

  console.log('[Pearson] Total upcoming assignments: ' + assignments.length);
  return assignments;
}
