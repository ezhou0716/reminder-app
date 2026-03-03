import { loadCookies, cookieHeader, type StoredCookie } from '../auth/cookie-store';
import { authenticateCalNet } from '../auth/calnet-auth';
import type { Assignment } from '../../shared/types/assignment';

const CANVAS_API_URL = process.env.CANVAS_API_URL || 'https://bcourses.berkeley.edu';
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
  const cookies = loadCookies('bcourses');
  if (!cookies) return false;

  try {
    const resp = await fetchWithCookies(`${CANVAS_API_URL}/api/v1/users/self`, cookies);
    return resp.status === 200;
  } catch {
    return false;
  }
}

export async function loginViaCalNet(): Promise<boolean> {
  const { calnetId, calnetPassphrase } = getCredentials();

  try {
    const cookies = await authenticateCalNet({
      url: `${CANVAS_API_URL}/login/cas`,
      cookieName: 'bcourses',
      successUrlPattern: 'bcourses.berkeley.edu',
      calnetId,
      calnetPassphrase,
    });
    return cookies.length > 0;
  } catch (err) {
    console.error('[Canvas] Login failed:', err);
    return false;
  }
}

export async function getUpcomingAssignments(): Promise<Assignment[]> {
  const cookies = loadCookies('bcourses');
  if (!cookies) return [];

  const now = new Date();
  const cutoff = new Date(now.getTime() + LOOKAHEAD_HOURS * 60 * 60 * 1000);
  const assignments: Assignment[] = [];

  try {
    // Fetch active courses
    const coursesResp = await fetchWithCookies(
      `${CANVAS_API_URL}/api/v1/courses?enrollment_state=active&per_page=100`,
      cookies,
    );
    if (coursesResp.status !== 200) {
      console.error('[Canvas] Failed to fetch courses:', coursesResp.status);
      return assignments;
    }

    const courses = (await coursesResp.json()) as Array<{
      id: number;
      name?: string;
    }>;

    for (const course of courses) {
      const courseId = course.id;
      const courseName = course.name || 'Unknown Course';

      try {
        const assignResp = await fetchWithCookies(
          `${CANVAS_API_URL}/api/v1/courses/${courseId}/assignments?bucket=upcoming&order_by=due_at&include[]=submission&per_page=100`,
          cookies,
        );
        if (assignResp.status !== 200) continue;

        const assignmentList = (await assignResp.json()) as Array<{
          id: number;
          name: string;
          due_at?: string;
          html_url?: string;
          submission?: { workflow_state?: string };
        }>;

        for (const a of assignmentList) {
          if (!a.due_at) continue;

          const dueAt = new Date(a.due_at);
          if (dueAt <= now || dueAt > cutoff) continue;

          const workflow = a.submission?.workflow_state || '';
          const submitted = workflow === 'submitted' || workflow === 'graded';

          assignments.push({
            id: String(a.id),
            name: a.name,
            courseName,
            dueAt: dueAt.toISOString(),
            url: a.html_url || '',
            source: 'canvas',
            submitted,
          });
        }
      } catch (err) {
        console.error(`[Canvas] Error fetching assignments for ${courseName}:`, err);
      }
    }
  } catch (err) {
    console.error('[Canvas] Error:', err);
  }

  return assignments;
}
