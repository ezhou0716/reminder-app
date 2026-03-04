import type { CalendarEventInput } from './event';

export interface CreateEventProposal {
  type: 'create';
  id: string;
  event: CalendarEventInput;
}

export interface UpdateEventProposal {
  type: 'update';
  id: string;
  eventId: string;
  changes: Partial<CalendarEventInput>;
  originalTitle?: string;
}

export interface DeleteEventProposal {
  type: 'delete';
  id: string;
  eventId: string;
  originalTitle?: string;
}

export type EventProposal = CreateEventProposal | UpdateEventProposal | DeleteEventProposal;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposals?: EventProposal[];
  filePaths?: string[];
  timestamp: number;
}

export interface AiStreamChunk {
  type: 'text_delta' | 'proposals' | 'done' | 'error';
  text?: string;
  proposals?: EventProposal[];
  error?: string;
}
