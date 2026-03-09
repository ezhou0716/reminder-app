import { GoogleGenAI, Type, FunctionCallingConfigMode } from '@google/genai';
import type { Content, FunctionDeclaration, Part } from '@google/genai';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { extname } from 'path';
import { getApiKey } from '../stores/settings-store';
import { getEventsInRange, createEvent, updateEvent, deleteEvent as deleteEventFromDb, getEventById } from '../db/repositories/events';
import { getCachedAssignments } from '../scheduler/assignment-checker';
import { getMainWindow } from '../windows';
import { isGoogleAuthenticated } from '../auth/google-auth';
import { fullSync, deleteFromGoogle } from '../clients/google-calendar-client';
import type { EventProposal, AiStreamChunk } from '../../shared/types/ai';
import type { CalendarEventInput } from '../../shared/types/event';

let conversationHistory: Content[] = [];

const MIME_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
};

const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'get_events',
    description: 'Get calendar events in a date range. ALWAYS call this before creating, updating, or deleting events.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        startTime: { type: Type.STRING, description: 'ISO 8601 start time with timezone offset, e.g. 2026-03-04T00:00:00-08:00' },
        endTime: { type: Type.STRING, description: 'ISO 8601 end time with timezone offset, e.g. 2026-03-04T23:59:59-08:00' },
      },
      required: ['startTime', 'endTime'],
    },
  },
  {
    name: 'create_event',
    description: 'Create a new calendar event. The event appears as a proposal for the user to accept or reject.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Event title' },
        startTime: { type: Type.STRING, description: 'ISO 8601 start time with timezone offset' },
        endTime: { type: Type.STRING, description: 'ISO 8601 end time with timezone offset' },
        description: { type: Type.STRING, description: 'Event description' },
        color: { type: Type.STRING, description: 'Hex color code. Default #003262 (blue), #10a37f (green) for study, #f59e0b (amber) for breaks' },
        location: { type: Type.STRING, description: 'Event location' },
      },
      required: ['title', 'startTime', 'endTime'],
    },
  },
  {
    name: 'update_event',
    description: 'Update an existing calendar event by its ID. Only include fields that should change.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        eventId: { type: Type.STRING, description: 'The event ID (from get_events results)' },
        title: { type: Type.STRING, description: 'New title' },
        startTime: { type: Type.STRING, description: 'New start time in ISO 8601 with timezone offset' },
        endTime: { type: Type.STRING, description: 'New end time in ISO 8601 with timezone offset' },
        description: { type: Type.STRING, description: 'New description' },
        color: { type: Type.STRING, description: 'New hex color' },
        location: { type: Type.STRING, description: 'New location' },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'delete_event',
    description: 'Delete a calendar event by its ID. Get the ID from get_events first. The deletion appears as a proposal for the user to accept or reject.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        eventId: { type: Type.STRING, description: 'The event ID to delete (from get_events results)' },
      },
      required: ['eventId'],
    },
  },
];

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'America/Los_Angeles',
  });
}

function buildSystemPrompt(weekStart: string, weekEnd: string): string {
  const events = getEventsInRange(weekStart, weekEnd);
  const assignments = getCachedAssignments();
  const now = new Date();

  const eventsSummary = events.length > 0
    ? events.map((e) => `- "${e.title}" | ${formatEventTime(e.startTime)} to ${formatEventTime(e.endTime)}${e.location ? ` | at ${e.location}` : ''} | id: ${e.id}`).join('\n')
    : 'No events this week.';

  const assignmentsSummary = assignments.length > 0
    ? assignments
      .filter((a) => !a.completed && !a.dismissed)
      .slice(0, 20)
      .map((a) => `- ${a.courseName}: ${a.name} (due ${formatEventTime(a.dueAt)})${a.submitted ? ' [submitted]' : ''}`)
      .join('\n')
    : 'No pending assignments.';

  return `You are an AI scheduling assistant built into a UC Berkeley student's personal calendar app. Today is ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. The user's timezone is America/Los_Angeles (Pacific Time).

Current week's events (${weekStart.slice(0, 10)} to ${weekEnd.slice(0, 10)}):
${eventsSummary}

Upcoming assignments:
${assignmentsSummary}

=== USER PROFILE ===

SLEEP & AVAILABILITY:
- Goes to bed anywhere from midnight to 3am, willing to work until sleep. Wakes up before classes on weekdays, typically 9am–noon.
- Actively trying to shift to an earlier schedule — prefer scheduling productive work before midnight and mornings around 9am when possible.
- Available time is primarily evenings and weekends.
- On weekdays, free time is whatever is not classes or sleep. On weekends, most of the day is free.

WORK STYLE — DEEP FOCUS, NOT SCATTERED:
- Strongly prefers long, uninterrupted blocks of focused work (2-4+ hours). Whether it's working out, schoolwork, startup building, or skill development — quality over quantity.
- Do NOT scatter small 30-60 minute blocks for different tasks across every day. Instead, dedicate each day to a couple of things done deeply.
- When scheduling a day, think: "What are the 2-3 things this person will focus on today?" — not "How do I fit 8 different tasks in?"

ACADEMICS — ASSIGNMENTS:
- Uses AI to complete most assignments efficiently. Many assignments don't require full attention/focus and can be grouped together in sequence (e.g., a 2-3 hour "assignment grinding" block covering multiple subjects).
- However, this depends on the specific assignment. The user will specify when they want to focus deeply on one assignment vs. batch several together. Default to grouping unless told otherwise.
- Assignments must be completed before their deadlines. Schedule them with enough buffer — not last-minute, but don't waste time either. Find efficient windows.
- Completing assignments and actually learning the material are treated as COMPLETELY SEPARATE activities.

ACADEMICS — STUDYING & LEARNING:
- Studying for understanding requires full focus — these are dedicated study sessions, distinct from assignment work.
- Prefers regular weekly study sessions per subject (e.g., "CS61B study" once a week) to stay in sequence with the course, rather than cramming before exams.
- Leading up to exams, study sessions should increase in frequency and intensity. But the baseline should be consistent weekly sessions.
- Study sessions should be substantial (1.5-2+ hours) — not tiny fragmented blocks.

SKIPPABLE CLASSES:
- The following classes CAN be skipped if needed or if it would optimize the schedule, but do NOT default to skipping them:
  • Physics 7B lectures (labs and discussions are NOT skippable)
  • CS61B lectures
  • UGBA 101A discussion (lecture is NOT skippable)
- Only skip these when the user asks, or when skipping clearly enables a much better schedule (e.g., fitting in a critical startup work block).

STARTUP / BUILDING:
- This is the user's biggest commitment outside of school. It requires regular, long blocks of focused deep work to succeed.
- Treat startup work as a high-priority recurring need — it should appear multiple times per week in substantial blocks (3-4+ hours).
- Evenings and weekends are prime time for startup work.

=== SCHEDULING RULES ===

1. BE AUTONOMOUS. Take action immediately — don't ask for confirmation. The user can accept or reject your proposals.
2. ALWAYS call get_events before creating/updating/deleting to get current event IDs and check for conflicts.
3. NEVER schedule overlapping events. If there's a conflict, pick the nearest free slot automatically.
4. All times must use ISO 8601 with Pacific offset (e.g. "2026-03-04T14:00:00-08:00").
5. Default color: #003262 (Berkeley Blue). Study sessions: #10a37f (green). Startup/building: #8E24AA (purple). Workouts: #E67C73 (flamingo). Assignment grinding: #F6BF26 (amber). Breaks: #f59e0b.
6. To delete an event: call get_events first to find the event ID, then call delete_event with that ID.
7. To update an event: call get_events first to find the event ID, then call update_event with the ID and changed fields.
8. If the user attaches a file (syllabus, schedule PDF, etc.), extract dates/deadlines and propose calendar events for them.
9. Be concise in your text responses — just confirm what you did.
10. When asked to schedule multiple things, create all the events in one go. Don't ask one at a time.

=== REALISTIC SCHEDULING ===

- Transit time: Leave 15-20 min gaps between events at different locations.
- Meals: Don't schedule over roughly 12-1pm lunch or 6-7:30pm dinner unless asked. Allow 1-1.5 hours after meals before workouts.
- Sleep window: Don't schedule anything before 9am or after midnight by default. The user CAN work until 3am but prefer keeping things before midnight to support the earlier-schedule goal.
- Long sessions: For focus blocks over 3 hours, include a short 10-15 min break in the middle. But don't break up 2-hour blocks — those are fine as-is.
- Context switching: Leave small buffers between unrelated activities (e.g., gym → study needs 15-20 min transition).
- Weekends: More relaxed, but this is prime time for startup work and catching up. Don't leave them empty — but don't pack them with scattered tasks either. Big focused blocks.
- Assignment deadlines: Schedule completion well before the deadline, not the night before. Group efficiently.`;
}

function sendStreamChunk(chunk: AiStreamChunk): void {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ai:streamChunk', chunk);
  }
}

function handleToolCall(name: string, args: Record<string, any>, proposals: EventProposal[]): Record<string, any> {
  if (name === 'get_events') {
    const events = getEventsInRange(args.startTime, args.endTime);
    return {
      count: events.length,
      events: events.map((e) => ({
        id: e.id, title: e.title,
        startTime: e.startTime, endTime: e.endTime,
        startFormatted: formatEventTime(e.startTime),
        endFormatted: formatEventTime(e.endTime),
        location: e.location, color: e.color,
      })),
    };
  } else if (name === 'create_event') {
    const proposal: EventProposal = {
      type: 'create',
      id: randomUUID(),
      event: {
        title: args.title,
        startTime: args.startTime,
        endTime: args.endTime,
        description: args.description,
        color: args.color || '#003262',
        location: args.location,
      },
    };
    proposals.push(proposal);
    return { status: 'proposed', proposalId: proposal.id };
  } else if (name === 'update_event') {
    const existing = getEventById(args.eventId);
    if (!existing) {
      return { error: `Event not found with id: ${args.eventId}. Use get_events to find the correct ID.` };
    }
    const changes: Partial<CalendarEventInput> = {};
    if (args.title) changes.title = args.title;
    if (args.startTime) changes.startTime = args.startTime;
    if (args.endTime) changes.endTime = args.endTime;
    if (args.description) changes.description = args.description;
    if (args.color) changes.color = args.color;
    if (args.location) changes.location = args.location;

    const proposal: EventProposal = {
      type: 'update',
      id: randomUUID(),
      eventId: args.eventId,
      changes,
      originalTitle: existing.title,
    };
    proposals.push(proposal);
    return { status: 'proposed', proposalId: proposal.id };
  } else if (name === 'delete_event') {
    const existing = getEventById(args.eventId);
    if (!existing) {
      return { error: `Event not found with id: ${args.eventId}. Use get_events to find the correct ID.` };
    }
    const proposal: EventProposal = {
      type: 'delete',
      id: randomUUID(),
      eventId: args.eventId,
      originalTitle: existing.title,
    };
    proposals.push(proposal);
    return { status: 'proposed', proposalId: proposal.id, deletedEvent: existing.title };
  }
  return { error: 'Unknown tool' };
}

function buildFilePart(filePath: string): Part | null {
  try {
    const ext = extname(filePath).toLowerCase();
    const mimeType = MIME_MAP[ext];
    if (!mimeType) return null;

    const data = readFileSync(filePath);
    return {
      inlineData: {
        mimeType,
        data: data.toString('base64'),
      },
    };
  } catch (err) {
    console.error('[AI Client] Failed to read file:', err);
    return null;
  }
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isRateLimit = err?.status === 429 || err?.message?.includes('429') || err?.message?.toLowerCase()?.includes('rate limit');
      if (!isRateLimit || attempt === maxRetries) throw err;
      const delay = Math.min(2000 * Math.pow(2, attempt), 15000); // 2s, 4s, 8s, cap at 15s
      console.log(`[AI Client] Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}

export async function sendMessage(userMessage: string, weekStart: string, weekEnd: string, filePaths?: string[]): Promise<void> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    sendStreamChunk({ type: 'error', error: 'No API key set. Please set your Gemini API key in settings.' });
    return;
  }

  const ai = new GoogleGenAI({ apiKey });
  const systemPrompt = buildSystemPrompt(weekStart, weekEnd);
  const proposals: EventProposal[] = [];

  // Build user message parts
  const userParts: Part[] = [{ text: userMessage }];
  if (filePaths) {
    for (const fp of filePaths) {
      const part = buildFilePart(fp);
      if (part) userParts.push(part);
    }
  }

  conversationHistory.push({ role: 'user', parts: userParts });

  try {
    let loopCount = 0;
    const maxLoops = 10;

    while (loopCount < maxLoops) {
      loopCount++;

      const stream = await withRetry(() => ai.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: conversationHistory,
        config: {
          systemInstruction: systemPrompt,
          tools: [{ functionDeclarations: toolDeclarations }],
          toolConfig: {
            functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
          },
        },
      }));

      let fullText = '';
      const functionCalls: Array<{ name: string; args: Record<string, any> }> = [];

      for await (const chunk of stream) {
        if (chunk.candidates && chunk.candidates.length > 0) {
          const parts = chunk.candidates[0].content?.parts || [];
          for (const part of parts) {
            if (part.text) {
              fullText += part.text;
              sendStreamChunk({ type: 'text_delta', text: part.text });
            }
            if (part.functionCall) {
              functionCalls.push({
                name: part.functionCall.name!,
                args: (part.functionCall.args as Record<string, any>) ?? {},
              });
            }
          }
        }
      }

      // Add model response to history
      const modelParts: Part[] = [];
      if (fullText) modelParts.push({ text: fullText });
      for (const fc of functionCalls) {
        modelParts.push({ functionCall: { name: fc.name, args: fc.args } });
      }
      conversationHistory.push({ role: 'model', parts: modelParts });

      if (functionCalls.length === 0) break;

      // Process tool calls and feed results back
      const responseParts: Part[] = [];
      for (const fc of functionCalls) {
        const result = handleToolCall(fc.name, fc.args, proposals);
        responseParts.push({
          functionResponse: { name: fc.name, response: result },
        });
      }
      conversationHistory.push({ role: 'user', parts: responseParts });
    }

    if (proposals.length > 0) {
      sendStreamChunk({ type: 'proposals', proposals });
    }
    sendStreamChunk({ type: 'done' });
  } catch (err) {
    console.error('[AI Client] Error:', err);
    sendStreamChunk({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

export async function executeProposals(proposals: EventProposal[]): Promise<void> {
  for (const proposal of proposals) {
    if (proposal.type === 'create') {
      createEvent(proposal.event);
    } else if (proposal.type === 'update') {
      updateEvent(proposal.eventId, proposal.changes);
    } else if (proposal.type === 'delete') {
      const existing = getEventById(proposal.eventId);
      if (existing?.googleEventId && isGoogleAuthenticated()) {
        await deleteFromGoogle(existing.googleEventId).catch(console.error);
      }
      deleteEventFromDb(proposal.eventId);
    }
  }

  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('events:updated');
  }

  if (isGoogleAuthenticated()) {
    try {
      await fullSync();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('events:updated');
      }
    } catch (err) {
      console.error('[AI Client] Sync after execute failed:', err);
    }
  }
}

export function clearConversation(): void {
  conversationHistory = [];
}
