import * as cheerio from 'cheerio';
import { BrowserWindow } from 'electron';
import { loadCookies, cookieHeader, type StoredCookie } from '../auth/cookie-store';
import { authenticateCalNet } from '../auth/calnet-auth';
import type { Assignment } from '../../shared/types/assignment';

const GRADESCOPE_URL = 'https://www.gradescope.com';
const LOOKAHEAD_HOURS = 168;

function getCredentials(): { calnetId: string; calnetPassphrase: string } {
  const email = process.env.GRADESCOPE_EMAIL || '';
  const password = process.env.GRADESCOPE_PASSWORD || '';
  return {
    calnetId: email.split('@')[0],
    calnetPassphrase: password,
  };
}

async function fetchWithCookies(url: string, cookies: StoredCookie[]): Promise<Response> {
  return fetch(url, {
    headers: {
      Cookie: cookieHeader(cookies),
    },
    redirect: 'manual',
  });
}

export async function cookiesValid(): Promise<boolean> {
  const cookies = loadCookies('gradescope');
  if (!cookies) return false;

  try {
    const resp = await fetchWithCookies(`${GRADESCOPE_URL}/account`, cookies);
    return resp.status === 200;
  } catch {
    return false;
  }
}

export async function loginViaCalNet(): Promise<boolean> {
  const { calnetId, calnetPassphrase } = getCredentials();

  try {
    const cookies = await authenticateCalNet({
      url: `${GRADESCOPE_URL}/saml`,
      cookieName: 'gradescope',
      successUrlPattern: 'gradescope.com',
      calnetId,
      calnetPassphrase,
      preCalnetSteps: async (win: BrowserWindow) => {
        // Wait for the SAML school-selection page to fully load
        await new Promise((r) => setTimeout(r, 2000));

        // Type "Berkeley" using keyboard events (not .value) so React's
        // search input actually filters. Then find and click the CalNet result.
        await win.webContents.executeJavaScript(`
          (function() {
            const input = document.querySelector("input[type='text'], input[placeholder]");
            if (!input) return;
            input.focus();
            // Use native setter + InputEvent to trigger React state update
            const nativeSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype, 'value'
            ).set;
            nativeSetter.call(input, 'Berkeley');
            input.dispatchEvent(new Event('input', { bubbles: true }));
          })();
        `);

        // Wait for search results to filter
        await new Promise((r) => setTimeout(r, 2000));

        // Find and click the CalNet/Berkeley result specifically
        await win.webContents.executeJavaScript(`
          (function() {
            const items = document.querySelectorAll('div.samlProvider--name');
            for (const item of items) {
              const text = item.textContent || '';
              if (text.includes('Berkeley') || text.includes('CalNet')) {
                item.click();
                return;
              }
            }
            // Fallback: click the first result if only one showed up
            if (items.length === 1) items[0].click();
          })();
        `);
      },
    });
    return cookies.length > 0;
  } catch (err) {
    console.error('[Gradescope] Login failed:', err);
    return false;
  }
}

function parseDate(text: string): Date | null {
  let cleaned = text.replace(/\n/g, ' ').trim();

  for (const prefix of ['Due ', 'Due: ', 'due ', 'Due Date: ']) {
    if (cleaned.startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length);
    }
  }
  cleaned = cleaned.trim();

  // Try various Gradescope date formats
  // "Mar 15, 2026 11:59 PM", "Mar 15, 2026 at 11:59 PM", "Mar 15 at 11:59 PM"
  const patterns = [
    /^(\w{3,9})\s+(\d{1,2}),?\s+(\d{4})\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(AM|PM)$/i,
    /^(\w{3,9})\s+(\d{1,2})\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(AM|PM)$/i,
  ];

  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    january: 0, february: 1, march: 2, april: 3, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };

  // Pattern 1: Full date with year
  const m1 = cleaned.match(patterns[0]);
  if (m1) {
    const month = months[m1[1].toLowerCase()];
    if (month === undefined) return null;
    const day = parseInt(m1[2]);
    const year = parseInt(m1[3]);
    let hour = parseInt(m1[4]);
    const minute = parseInt(m1[5]);
    const ampm = m1[6].toUpperCase();
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;

    // Gradescope displays in Pacific time
    const pacific = new Date(Date.UTC(year, month, day, hour + 8, minute)); // Approximate PST=UTC-8
    return pacific;
  }

  // Pattern 2: Date without year
  const m2 = cleaned.match(patterns[1]);
  if (m2) {
    const month = months[m2[1].toLowerCase()];
    if (month === undefined) return null;
    const day = parseInt(m2[2]);
    const year = new Date().getFullYear();
    let hour = parseInt(m2[3]);
    const minute = parseInt(m2[4]);
    const ampm = m2[5].toUpperCase();
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;

    const pacific = new Date(Date.UTC(year, month, day, hour + 8, minute));
    return pacific;
  }

  return null;
}

export async function getUpcomingAssignments(): Promise<Assignment[]> {
  const cookies = loadCookies('gradescope');
  if (!cookies) return [];

  const now = new Date();
  const cutoff = new Date(now.getTime() + LOOKAHEAD_HOURS * 60 * 60 * 1000);
  const assignments: Assignment[] = [];

  try {
    // Fetch account page for course list
    const accountResp = await fetchWithCookies(`${GRADESCOPE_URL}/account`, cookies);
    if (accountResp.status !== 200) return assignments;

    const html = await accountResp.text();
    const $ = cheerio.load(html);

    // Find course links
    const seenCourses = new Set<string>();
    const courseLinks: Array<{ id: string; name: string }> = [];

    $('a[href*="/courses/"]').each((_i, el) => {
      const href = $(el).attr('href') || '';
      const match = href.match(/\/courses\/(\d+)/);
      if (!match) return;
      const courseId = match[1];
      if (seenCourses.has(courseId)) return;
      seenCourses.add(courseId);

      const shortName = $(el).find('h3.courseBox--shortname').text().trim();
      const fullName = $(el).find('div.courseBox--name').text().trim();
      const courseName = shortName || fullName || $(el).text().trim() || `Course ${courseId}`;

      courseLinks.push({ id: courseId, name: courseName });
    });

    // Fetch assignments for each course
    for (const course of courseLinks) {
      try {
        const courseResp = await fetchWithCookies(
          `${GRADESCOPE_URL}/courses/${course.id}`,
          cookies,
        );
        if (courseResp.status !== 200) continue;

        const courseHtml = await courseResp.text();
        const $c = cheerio.load(courseHtml);

        const rows = $c('tr[role="row"]').length > 0
          ? $c('tr[role="row"]')
          : $c('tr');

        rows.each((_i, row) => {
          const cells = $c(row).find('td');
          if (cells.length === 0) return;

          const th = $c(row).find('th');
          const name = th.length > 0
            ? th.text().trim()
            : $c(cells[0]).text().trim();

          // Get assignment ID
          let assignId: string | null = null;
          const assignLink = $c(row).find('a[href*="/assignments/"]');
          if (assignLink.length > 0) {
            const href = assignLink.attr('href') || '';
            const match = href.match(/\/assignments\/(\d+)/);
            if (match) assignId = match[1];
          }
          if (!assignId) {
            const submitBtn = $c(row).find('button.js-submitAssignment');
            if (submitBtn.length > 0) {
              assignId = submitBtn.attr('data-assignment-id') || null;
            }
          }
          if (!assignId) return;

          // Parse due date
          let dueAt: Date | null = null;
          const dueEl = $c(row).find('.submissionTimeChart--dueDate');
          if (dueEl.length > 0 && dueEl.attr('datetime')) {
            try {
              dueAt = new Date(dueEl.attr('datetime')!);
            } catch { /* ignore */ }
          }

          if (!dueAt) {
            cells.each((_j, cell) => {
              if (dueAt) return;
              const parsed = parseDate($c(cell).text().trim());
              if (parsed) dueAt = parsed;
            });
          }

          if (!dueAt) return;
          if (dueAt <= now || dueAt > cutoff) return;

          // Check submission status
          const rowText = $c(row).text();
          const submitted =
            rowText.includes('Submitted') ||
            $c(row).find('.submissionStatus--submitted').length > 0 ||
            $c(row).find('.workflowCheck--complete').length > 0;

          assignments.push({
            id: `gs_${course.id}_${assignId}`,
            name,
            courseName: course.name,
            dueAt: dueAt.toISOString(),
            url: `${GRADESCOPE_URL}/courses/${course.id}/assignments/${assignId}`,
            source: 'gradescope',
            submitted,
          });
        });
      } catch (err) {
        console.error(`[Gradescope] Error fetching assignments for ${course.name}:`, err);
      }
    }
  } catch (err) {
    console.error('[Gradescope] Error:', err);
  }

  return assignments;
}
