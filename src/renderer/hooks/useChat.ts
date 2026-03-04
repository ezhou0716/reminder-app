import { useEffect } from 'react';
import { useChatStore } from '@/stores/chat-store';

export function useChat() {
  const store = useChatStore();

  useEffect(() => {
    store.checkApiKey();

    const unsubscribe = window.electronAPI.onAiStreamChunk((chunk) => {
      useChatStore.getState().handleStreamChunk(chunk);
    });

    return unsubscribe;
  }, []);

  return store;
}
