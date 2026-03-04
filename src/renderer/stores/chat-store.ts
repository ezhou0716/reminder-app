import { create } from 'zustand';
import type { ChatMessage, EventProposal, AiStreamChunk } from '@shared/types/ai';

interface ChatState {
  panelOpen: boolean;
  messages: ChatMessage[];
  streaming: boolean;
  streamingText: string;
  proposals: EventProposal[];
  acceptedProposalIds: Set<string>;
  rejectedProposalIds: Set<string>;
  hasApiKey: boolean;

  togglePanel: () => void;
  sendMessage: (message: string, weekStart: string, weekEnd: string, filePaths?: string[]) => Promise<void>;
  clearConversation: () => void;
  acceptProposal: (id: string) => void;
  rejectProposal: (id: string) => void;
  acceptAllProposals: () => void;
  rejectAllProposals: () => void;
  executeAccepted: () => Promise<void>;
  handleStreamChunk: (chunk: AiStreamChunk) => void;
  checkApiKey: () => Promise<void>;
  setApiKey: (key: string) => Promise<void>;
  clearApiKey: () => Promise<void>;
}

let messageCounter = 0;

export const useChatStore = create<ChatState>((set, get) => ({
  panelOpen: false,
  messages: [],
  streaming: false,
  streamingText: '',
  proposals: [],
  acceptedProposalIds: new Set(),
  rejectedProposalIds: new Set(),
  hasApiKey: false,

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  sendMessage: async (message, weekStart, weekEnd, filePaths) => {
    const userMsg: ChatMessage = {
      id: `msg-${++messageCounter}`,
      role: 'user',
      content: message,
      filePaths,
      timestamp: Date.now(),
    };

    set((s) => ({
      messages: [...s.messages, userMsg],
      streaming: true,
      streamingText: '',
    }));

    try {
      await window.electronAPI.aiSendMessage(message, weekStart, weekEnd, filePaths);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `msg-${++messageCounter}`,
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
        timestamp: Date.now(),
      };
      set((s) => ({
        messages: [...s.messages, errorMsg],
        streaming: false,
        streamingText: '',
      }));
    }
  },

  clearConversation: () => {
    window.electronAPI.aiClearConversation();
    set({
      messages: [],
      streaming: false,
      streamingText: '',
      proposals: [],
      acceptedProposalIds: new Set(),
      rejectedProposalIds: new Set(),
    });
  },

  acceptProposal: (id) => {
    set((s) => {
      const accepted = new Set(s.acceptedProposalIds);
      const rejected = new Set(s.rejectedProposalIds);
      accepted.add(id);
      rejected.delete(id);
      return { acceptedProposalIds: accepted, rejectedProposalIds: rejected };
    });
  },

  rejectProposal: (id) => {
    set((s) => {
      const accepted = new Set(s.acceptedProposalIds);
      const rejected = new Set(s.rejectedProposalIds);
      rejected.add(id);
      accepted.delete(id);
      return { acceptedProposalIds: accepted, rejectedProposalIds: rejected };
    });
  },

  acceptAllProposals: () => {
    const { proposals } = get();
    const accepted = new Set(proposals.map((p) => p.id));
    set({ acceptedProposalIds: accepted, rejectedProposalIds: new Set() });
  },

  rejectAllProposals: () => {
    const { proposals } = get();
    const rejected = new Set(proposals.map((p) => p.id));
    set({ rejectedProposalIds: rejected, acceptedProposalIds: new Set() });
  },

  executeAccepted: async () => {
    const { proposals, acceptedProposalIds } = get();
    const toExecute = proposals.filter((p) => acceptedProposalIds.has(p.id));
    if (toExecute.length === 0) return;

    try {
      await window.electronAPI.aiExecuteProposals(toExecute);
      // Remove executed proposals
      set((s) => ({
        proposals: s.proposals.filter((p) => !acceptedProposalIds.has(p.id)),
        acceptedProposalIds: new Set(),
      }));
    } catch (err) {
      console.error('Failed to execute proposals:', err);
    }
  },

  handleStreamChunk: (chunk) => {
    if (chunk.type === 'text_delta') {
      set((s) => ({ streamingText: s.streamingText + (chunk.text ?? '') }));
    } else if (chunk.type === 'proposals') {
      set((s) => ({
        proposals: [...s.proposals, ...(chunk.proposals ?? [])],
      }));
    } else if (chunk.type === 'done') {
      const { streamingText, proposals } = get();
      if (streamingText) {
        const assistantMsg: ChatMessage = {
          id: `msg-${++messageCounter}`,
          role: 'assistant',
          content: streamingText,
          proposals: proposals.length > 0 ? [...proposals] : undefined,
          timestamp: Date.now(),
        };
        set((s) => ({
          messages: [...s.messages, assistantMsg],
          streaming: false,
          streamingText: '',
        }));
      } else {
        set({ streaming: false, streamingText: '' });
      }
    } else if (chunk.type === 'error') {
      const errorMsg: ChatMessage = {
        id: `msg-${++messageCounter}`,
        role: 'assistant',
        content: chunk.error ?? 'An error occurred.',
        timestamp: Date.now(),
      };
      set((s) => ({
        messages: [...s.messages, errorMsg],
        streaming: false,
        streamingText: '',
      }));
    }
  },

  checkApiKey: async () => {
    const has = await window.electronAPI.aiHasApiKey();
    set({ hasApiKey: has });
  },

  setApiKey: async (key) => {
    await window.electronAPI.aiSetApiKey(key);
    set({ hasApiKey: true });
  },

  clearApiKey: async () => {
    await window.electronAPI.aiClearApiKey();
    set({ hasApiKey: false });
  },
}));
