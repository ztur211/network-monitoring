import { create } from 'zustand';
import { AiUsageDto } from '@nodescope/shared';
import { api } from '../lib/api.service';
import { websocketService } from '../lib/websocket.service';
import { WS_EVENTS } from '@nodescope/shared';

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming: boolean;
  timestamp: string;
  usageWarning: string | null;
  providerStatus: 'ok' | 'unavailable';
}

interface AiStore {
  messages: AiMessage[];
  conversationId: string | null;
  isStreaming: boolean;
  usage: AiUsageDto | null;
  isLoadingUsage: boolean;
  error: string | null;
  providerAvailable: boolean;

  addUserMessage: (content: string) => void;
  startAssistantMessage: () => void;
  appendTokenToCurrentMessage: (token: string) => void;
  completeCurrentMessage: (
    finalContent: string,
    conversationId: string,
    meta: {
      tokensUsed: number;
      monthlyBudgetRemaining: number;
      usageWarning: string | null;
      providerStatus: 'ok' | 'unavailable';
    },
  ) => void;
  setUsage: (usage: AiUsageDto) => void;
  setError: (error: string | null) => void;
  setProviderAvailable: (available: boolean) => void;
  clearConversation: () => Promise<void>;
  loadUsage: () => Promise<void>;
  sendMessage: (content: string) => void;
  retryLastMessage: () => void;
}

function tempId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Returns the content of the most recent user message, or null when the
 * transcript has none. Extracted from retryLastMessage so the reverse scan
 * is independently testable.
 */
export function findLastUserContent(messages: AiMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return null;
}

export const useAiStore = create<AiStore>((set, get) => ({
  messages: [],
  conversationId: null,
  isStreaming: false,
  usage: null,
  isLoadingUsage: false,
  error: null,
  providerAvailable: true,

  addUserMessage: (content) => {
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: tempId(),
          role: 'user',
          content,
          streaming: false,
          timestamp: new Date().toISOString(),
          usageWarning: null,
          providerStatus: 'ok',
        },
      ],
      error: null,
    }));
  },

  startAssistantMessage: () => {
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: tempId(),
          role: 'assistant',
          content: '',
          streaming: true,
          timestamp: new Date().toISOString(),
          usageWarning: null,
          providerStatus: 'ok',
        },
      ],
      isStreaming: true,
    }));
  },

  appendTokenToCurrentMessage: (token) => {
    set((state) => {
      const messages = [...state.messages];
      const lastIdx = messages.length - 1;
      if (lastIdx >= 0 && messages[lastIdx].streaming) {
        messages[lastIdx] = { ...messages[lastIdx], content: messages[lastIdx].content + token };
      }
      return { messages };
    });
  },

  completeCurrentMessage: (finalContent, conversationId, meta) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.streaming
          ? {
              ...m,
              content: finalContent,
              streaming: false,
              usageWarning: meta.usageWarning,
              providerStatus: meta.providerStatus,
            }
          : m,
      ),
      conversationId,
      isStreaming: false,
      providerAvailable: meta.providerStatus !== 'unavailable',
    }));
  },

  setUsage: (usage) => set({ usage }),

  setError: (error) => set({ error, isStreaming: false }),

  setProviderAvailable: (available) => set({ providerAvailable: available }),

  clearConversation: async () => {
    const { conversationId } = get();
    if (conversationId) {
      try {
        await api.delete(`/ai/conversation/${conversationId}`);
      } catch {
        // If the conversation was already gone, that's fine
      }
    }
    set({ messages: [], conversationId: null, error: null });
  },

  loadUsage: async () => {
    set({ isLoadingUsage: true });
    try {
      const res = await api.get<{ success: boolean; data: AiUsageDto }>('/ai/usage');
      set({ usage: res.data.data, isLoadingUsage: false });
    } catch {
      set({ isLoadingUsage: false });
    }
  },

  sendMessage: (content) => {
    const { isStreaming, conversationId } = get();
    if (isStreaming) return;

    get().addUserMessage(content);
    get().startAssistantMessage();

    websocketService.emit(WS_EVENTS.AI_MESSAGE, {
      content,
      conversationId,
    });
  },

  retryLastMessage: () => {
    const { isStreaming, conversationId, messages } = get();
    if (isStreaming) return;

    const lastUserContent = findLastUserContent(messages);
    if (!lastUserContent) return;

    set((state) => ({
      messages: state.messages.filter(
        (m) => !(m.role === 'assistant' && m.streaming && m.content === ''),
      ),
      error: null,
    }));
    get().startAssistantMessage();
    websocketService.emit(WS_EVENTS.AI_MESSAGE, {
      content: lastUserContent,
      conversationId,
    });
  },
}));
