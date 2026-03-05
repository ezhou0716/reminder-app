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
    // 200 = direct success, 301/302 = normal redirect to dashboard (still authenticated)
    // If redirected to a login/auth page, that means cookies expired
    if (resp.status === 200) return true;
    if (resp.status === 301 || resp.status === 302) {
      const location = resp.headers.get('location') || '';
      // If redirect goes to an auth/login page, cookies are invalid
      if (isAuthUrl(location)) return false;
      // Otherwise it's a normal redirect (e.g. to dashboard) — still authenticated
      return true;
    }
    return false;
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

    // ── Step 2: Wait for course card titles to render, then extract them ──
    // Pearson dashboard is an AngularJS SPA — card titles render asynchronously.
    // Known structure: div.title-wrapper.pointer > span.title.ellipsis.card-font
    await waitForContent(
      win,
      `document.querySelectorAll('.title-wrapper, [class*="title-wrapper"], .card-header, card-view').length > 0`,
      15000,
    );

    const courseTitles: string[] = await win.webContents.executeJavaScript(`
      (function() {
        const titles = [];
        // Primary: known Pearson card title structure
        let titleEls = document.querySelectorAll('.title-wrapper, [class*="title-wrapper"]');
        if (titleEls.length === 0) {
          // Fallback: try card-header or card-view
          titleEls = document.querySelectorAll('.card-header, card-view');
        }
        for (const el of titleEls) {
          const text = (el.textContent || '').trim().replace(/\\s+/g, ' ');
          // Skip short strings that are likely badges/counts (e.g. "30 (1)")
          if (text.length > 10 && /[a-zA-Z]{3,}/.test(text)) titles.push(text.substring(0, 150));
        }
        if (titles.length > 0) return titles;

        // Last resort: find elements with semester text pattern
        const semPattern = /(Spring|Fall|Summer|Winter)\\s+20\\d{2}/i;
        const all = document.querySelectorAll('span, div, a');
        for (const el of all) {
          const text = (el.textContent || '').trim();
          // Must be a course title (short, matches semester, no children with same text)
          if (text.length > 10 && text.length < 100 && semPattern.test(text)) {
            const firstChild = el.querySelector('span, div, a');
            if (!firstChild || firstChild.textContent.trim() !== text) {
              titles.push(text.replace(/\\s+/g, ' ').substring(0, 150));
            }
          }
        }
        return titles;
      })()
    `);

    console.log('[Pearson] Course titles found:', courseTitles);

    if (courseTitles.length === 0) {
      const debugInfo: string = await win.webContents.executeJavaScript(`
        JSON.stringify({
          url: location.href,
          titleWrappers: document.querySelectorAll('.title-wrapper').length,
          cardHeaders: document.querySelectorAll('.card-header').length,
          cardViews: document.querySelectorAll('card-view').length,
          bodySnippet: document.body.innerText.substring(0, 500),
        })
      `);
      console.log('[Pearson] No course titles found. Debug:', debugInfo);
      return assignments;
    }

    // ── Step 3: Click each course and scrape assignments ──
    for (let i = 0; i < courseTitles.length; i++) {
      const title = courseTitles[i];
      try {
        // Navigate back to dashboard first (except for the first course)
        if (i > 0) {
          await win.loadURL(PEARSON_DASHBOARD);
          await waitForContent(win, `document.querySelectorAll('.title-wrapper, .card-header, card-view').length > 0`, 15000);
        }

        capturedPopupUrl = null;
        console.log('[Pearson] Clicking course:', title);

        // Click the course title element with proper MouseEvent
        // Use includes() for matching since whitespace may differ between queries
        const clicked: boolean = await win.webContents.executeJavaScript(`
          (function() {
            const target = ${JSON.stringify(title)};
            // Try all possible selectors for course title elements
            const selectors = ['.title-wrapper', '[class*="title-wrapper"]', '.card-header', 'card-view', '.tile'];
            for (const sel of selectors) {
              const els = document.querySelectorAll(sel);
              for (const el of els) {
                const text = (el.textContent || '').trim().replace(/\\s+/g, ' ');
                if (text === target || text.includes(target) || target.includes(text.substring(0, 30))) {
                  const rect = el.getBoundingClientRect();
                  if (rect.width === 0 || rect.height === 0) continue; // skip hidden elements
                  const cx = rect.left + rect.width / 2;
                  const cy = rect.top + rect.height / 2;
                  const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 };
                  el.dispatchEvent(new MouseEvent('mousedown', opts));
                  el.dispatchEvent(new MouseEvent('mouseup', opts));
                  el.dispatchEvent(new MouseEvent('click', opts));
                  return true;
                }
              }
            }
            return false;
          })()
        `);

        if (!clicked) {
          console.log('[Pearson] Could not find title element to click');
          continue;
        }

        // Wait for navigation to mylabmastering (poll for up to 10 seconds)
        let courseUrl: string | null = null;
        for (let wait = 0; wait < 20; wait++) {
          await new Promise((r) => setTimeout(r, 500));
          if (win.isDestroyed()) break;

          const curUrl = win.webContents.getURL();
          if (curUrl.includes('mylabmastering')) {
            courseUrl = curUrl;
            break;
          }

          const popup = capturedPopupUrl as string | null;
          if (popup && popup.includes('mylabmastering')) {
            courseUrl = popup;
            break;
          }
        }

        if (!courseUrl) {
          console.log('[Pearson] Click did not navigate to mylabmastering | URL:', win.webContents.getURL());
          continue;
        }
        console.log('[Pearson] Reached:', courseUrl);

        // If course URL came from a popup, navigate to it
        if (!win.webContents.getURL().includes('mylabmastering')) {
          await win.loadURL(courseUrl);
        }

        // The initial URL is /?courseId=XXXXX — wait for it to redirect to /courses/XXXXX/menu/...
        // This is a SPA that loads and then does a client-side redirect
        const settled = await waitForContent(
          win,
          `location.href.includes('/courses/') || location.href.includes('/menu/')`,
          15000,
        );

        // Also extract courseId from the URL (either format)
        const settledUrl = win.webContents.getURL();
        let courseIdMatch = settledUrl.match(/\/courses\/(\d+)/);
        if (!courseIdMatch) courseIdMatch = settledUrl.match(/courseId=(\d+)/);
        const courseId = courseIdMatch ? courseIdMatch[1] : '';

        console.log('[Pearson] Course page settled:', settledUrl, '| redirect completed:', settled);

        // Check for auth redirect
        if (isAuthUrl(settledUrl)) {
          console.log('[Pearson] Course page redirected to auth — skipping');
          break;
        }

        // The course page is a shell — actual content (assignments) loads in an
        // LTI iframe. We need to find that iframe URL and navigate to it directly.
        await new Promise((r) => setTimeout(r, 3000));

        // Extract the LTI iframe URL (contains the auth token)
        const ltiUrl: string | null = await win.webContents.executeJavaScript(`
          (function() {
            const iframes = document.querySelectorAll('iframe');
            for (const f of iframes) {
              const src = f.src || '';
              // The LTI launch iframe is on mylabmastering.pearson.com/api/courses/
              if (src.includes('mylabmastering') && src.includes('/launch')) return src;
              if (src.includes('mylabmastering') && src.includes('/api/')) return src;
            }
            // Fallback: any iframe on the same domain with content
            for (const f of iframes) {
              const src = f.src || '';
              if (src.includes('mylabmastering') && src.length > 50) return src;
            }
            return null;
          })()
        `);

        if (!ltiUrl) {
          console.log('[Pearson] No LTI iframe found on course page');
          const debugDump: string = await win.webContents.executeJavaScript(`
            JSON.stringify({
              url: location.href,
              iframes: Array.from(document.querySelectorAll('iframe')).map(f => f.src || '(no src)'),
              bodySnippet: document.body.innerText.substring(0, 500),
            })
          `);
          console.log('[Pearson] Debug:', debugDump);
          continue;
        }

        console.log('[Pearson] Navigating to LTI iframe URL...');
        await win.loadURL(ltiUrl);

        // Wait for the page shell to load first
        await waitForContent(
          win,
          `(function() {
            const text = document.body.innerText || '';
            return text.length > 200 && (
              text.includes('Assignment') || text.includes('Homework') ||
              text.includes('Quiz') || text.includes('Due') ||
              text.includes('Chapter') || text.includes('Test') ||
              text.includes('Score') || text.includes('Study Plan')
            );
          })()`,
          25000,
        );

        // Now wait for actual assignment rows to populate (they load asynchronously)
        // The shell loads instantly with empty placeholders (emptyContainer--emptyRow),
        // then the real li.assignment-row elements appear once data arrives.
        const assignmentsLoaded = await waitForContent(
          win,
          `(function() {
            // Check for Mastering-style assignment rows
            if (document.querySelectorAll('li.assignment-row').length > 0) return true;
            // Check for any date pattern in body text (means assignments rendered)
            const text = document.body.innerText || '';
            if (/\\d{1,2}\\/\\d{1,2}\\/\\d{4}\\s+\\d{1,2}:\\d{2}\\s*(?:AM|PM)/i.test(text)) return true;
            return false;
          })()`,
          20000,
        );

        if (!assignmentsLoaded) {
          const debugDump: string = await win.webContents.executeJavaScript(`
            JSON.stringify({
              url: location.href,
              title: document.title,
              bodyLength: (document.body.innerText || '').length,
              assignmentRows: document.querySelectorAll('li.assignment-row').length,
              emptyRows: document.querySelectorAll('.emptyContainer--emptyRow').length,
              bodySnippet: document.body.innerText.substring(0, 1500),
            })
          `);
          console.log('[Pearson] Assignment rows did not load. Debug:', debugDump);
          continue;
        }

        console.log('[Pearson] LTI content loaded at:', win.webContents.getURL());

        // ── DEBUG: Dump full page content so we can see what Mastering Physics renders ──
        const fullDebug: string = await win.webContents.executeJavaScript(`
          JSON.stringify({
            url: location.href,
            title: document.title,
            bodyText: (document.body.innerText || '').substring(0, 5000),
            bodyHTML: (document.body.innerHTML || '').substring(0, 10000),
            allLinks: Array.from(document.querySelectorAll('a')).slice(0, 30).map(a => ({
              text: (a.textContent || '').trim().substring(0, 80),
              href: a.href,
              classes: a.className,
            })),
            allIframes: Array.from(document.querySelectorAll('iframe')).map(f => ({
              src: f.src || '(none)',
              id: f.id || '(none)',
            })),
            tables: document.querySelectorAll('table').length,
            listItems: document.querySelectorAll('li').length,
            dateTexts: (document.body.innerText || '').match(/\\d{1,2}\\/\\d{1,2}\\/\\d{4}/g) || [],
          })
        `);
        console.log('[Pearson] === FULL PAGE DEBUG START ===');
        console.log(fullDebug);
        console.log('[Pearson] === FULL PAGE DEBUG END ===');

        // Extract course name from rendered page
        const courseName: string = await win.webContents.executeJavaScript(`
          (function() {
            const banner = document.querySelector('[class*="course-title"], [class*="courseName"], .banner-title, [class*="header"] h1, [class*="header"] h2');
            if (banner) {
              const t = banner.textContent.trim();
              // Skip generic headers like "Course Home"
              if (t.length > 3 && !/^Course Home$/i.test(t)) return t.substring(0, 100);
            }
            const h1 = document.querySelector('h1');
            if (h1 && h1.textContent.trim().length > 3) return h1.textContent.trim().substring(0, 100);
            return document.title || '';
          })()
        `);
        const displayName = courseName || title;
        console.log('[Pearson] Course name:', displayName);

        // Extract assignments from the live DOM
        const rawAssignments: Array<{ name: string; url: string; date: string; section: string }> =
          await win.webContents.executeJavaScript(`
            (function() {
              const results = [];
              const seen = new Set();
              const datePattern = /\\d{1,2}\\/\\d{1,2}\\/\\d{4}\\s+\\d{1,2}:\\d{2}\\s*(?:AM|PM)/i;

              // Strategy 1: Mastering Physics specific selectors
              // Structure: div.list-container > div.list-heading (section header) + div (panel with ul > li.assignment-row)
              const containers = document.querySelectorAll('.list-container');
              for (const container of containers) {
                // Determine section from the heading text
                const heading = container.querySelector('.list-heading, .collapsible-container-header');
                const headingText = (heading ? heading.textContent : '') || '';
                let section = 'unknown';
                if (/upcoming/i.test(headingText))        section = 'upcoming';
                else if (/past\\s*due/i.test(headingText)) section = 'past_due';
                else if (/completed/i.test(headingText))  section = 'completed';

                const rows = container.querySelectorAll('li.assignment-row');
                for (const row of rows) {
                  const link = row.querySelector('a.assignment-row--div--link');
                  const name = link ? link.textContent.trim() : '';
                  if (!name || name.length < 3) continue;

                  // Date is in the sibling div with col-md-2 class
                  const dateDivs = row.querySelectorAll('.col-xs-4.col-md-2, .col-md-2');
                  let dateStr = '';
                  for (const d of dateDivs) {
                    const t = (d.textContent || '').trim();
                    const m = t.match(datePattern);
                    if (m) { dateStr = m[0]; break; }
                  }
                  // Fallback: check aria-label on the link (contains date info)
                  if (!dateStr && link) {
                    const aria = link.getAttribute('aria-label') || '';
                    const m = aria.match(datePattern);
                    if (m) dateStr = m[0];
                  }
                  if (!dateStr) continue;

                  const key = name + '|' + dateStr;
                  if (seen.has(key)) continue;
                  seen.add(key);

                  results.push({ name: name.substring(0, 150), url: link ? link.href : '', date: dateStr, section });
                }
              }

              // Strategy 2: Generic fallback for non-Mastering layouts
              if (results.length === 0) {
                const rows = document.querySelectorAll('tr, li');
                for (const row of rows) {
                  const rowText = row.textContent || '';
                  const dateMatch = rowText.match(datePattern);
                  if (!dateMatch) continue;

                  const link = row.querySelector('a[href]');
                  let name = '';
                  let url = '';
                  if (link) { name = link.textContent.trim(); url = link.href; }
                  if (!name || name.length < 3) {
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
                  if (name.match(/^(Upcoming|Past Due|Completed|All |Assignments$)/i)) continue;

                  const key = name + '|' + dateMatch[0];
                  if (seen.has(key)) continue;
                  seen.add(key);

                  // Section detection: walk up to find list-container with heading
                  let section = 'unknown';
                  let parent = row.parentElement;
                  let pSteps = 0;
                  while (parent && pSteps < 10) {
                    const heading = parent.querySelector('.list-heading, .collapsible-container-header');
                    if (heading) {
                      const ht = heading.textContent || '';
                      if (/upcoming/i.test(ht))        { section = 'upcoming'; break; }
                      if (/past\\s*due/i.test(ht))      { section = 'past_due'; break; }
                      if (/completed/i.test(ht))        { section = 'completed'; break; }
                    }
                    parent = parent.parentElement;
                    pSteps++;
                  }

                  results.push({ name: name.substring(0, 150), url, date: dateMatch[0], section });
                }
              }

              // Strategy 3: Last resort text scanning
              if (results.length === 0) {
                const lines = (document.body.innerText || '').split('\\n').filter(l => l.trim());
                for (let i = 0; i < lines.length; i++) {
                  const dateMatch = lines[i].match(datePattern);
                  if (!dateMatch) continue;
                  let name = '';
                  for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
                    const prev = lines[j].trim();
                    if (prev.length > 3 && !prev.match(datePattern) && !prev.match(/^(Due|Score|Status)/i)) {
                      name = prev.substring(0, 150);
                      break;
                    }
                  }
                  if (name) {
                    const key = name + '|' + dateMatch[0];
                    if (!seen.has(key)) {
                      seen.add(key);
                      results.push({ name, url: '', date: dateMatch[0], section: 'unknown' });
                    }
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
            url: courseUrl,
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
