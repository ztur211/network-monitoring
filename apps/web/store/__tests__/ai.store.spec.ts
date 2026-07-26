/**
 * Unit tests for ai.store — the Zustand slice that drives the AI chat
 * window. Tracks: messages[], conversationId, isStreaming, usage,
 * isLoadingUsage, error, providerAvailable.
 *
 * Mocks axios (used by loadUsage + clearConversation) and spies on
 * websocketService.emit (used by sendMessage + retryLastMessage) so the
 * store exercises its real call chain without a network round trip or a
 * live socket.
 */
import { WS_EVENTS, AiUsageDto } from '@nodescope/shared';

const mockGet = vi.fn();
const mockDelete = vi.fn();

vi.doMock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: mockGet,
      delete: mockDelete,
      post: vi.fn(),
      patch: vi.fn(),
      interceptors: { response: { use: vi.fn() } },
    })),
    isAxiosError: vi.fn(() => false),
  },
}));

const { useAiStore, findLastUserContent } = await import('../ai.store');
const { websocketService } = await import('../../lib/websocket.service');

const emitSpy = vi.spyOn(websocketService, 'emit').mockImplementation(() => undefined);

function resetStore(): void {
  useAiStore.setState({
    messages: [],
    conversationId: null,
    isStreaming: false,
    usage: null,
    isLoadingUsage: false,
    error: null,
    providerAvailable: true,
  });
}

const sampleUsage: AiUsageDto = {
  hourlyUsed: 3,
  hourlyLimit: 30,
  dailyUsed: 12,
  dailyLimit: 100,
  monthlyTokensUsed: 4500,
  monthlyTokenBudget: 100_000,
  resetsAt: '2026-06-01T00:00:00.000Z',
};

describe('ai.store', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockDelete.mockReset();
    emitSpy.mockClear();
    resetStore();
  });

  describe('addUserMessage', () => {
    it('appends a user message with empty content cleared and clears any prior error', () => {
      useAiStore.setState({ error: 'stale error' });
      useAiStore.getState().addUserMessage('hello');

      const { messages, error } = useAiStore.getState();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: 'user',
        content: 'hello',
        streaming: false,
      });
      expect(error).toBeNull();
    });
  });

  describe('startAssistantMessage', () => {
    it('appends an empty streaming assistant message and flips isStreaming true', () => {
      useAiStore.getState().startAssistantMessage();

      const { messages, isStreaming } = useAiStore.getState();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: 'assistant',
        content: '',
        streaming: true,
      });
      expect(isStreaming).toBe(true);
    });
  });

  describe('appendTokenToCurrentMessage', () => {
    it('appends the token to the last streaming message', () => {
      useAiStore.getState().startAssistantMessage();
      useAiStore.getState().appendTokenToCurrentMessage('hel');
      useAiStore.getState().appendTokenToCurrentMessage('lo');

      const { messages } = useAiStore.getState();
      expect(messages[messages.length - 1].content).toBe('hello');
    });

    it('is a no-op when the trailing message is not streaming', () => {
      useAiStore.getState().addUserMessage('hi');
      useAiStore.getState().appendTokenToCurrentMessage('ignored');

      const { messages } = useAiStore.getState();
      expect(messages[messages.length - 1].content).toBe('hi');
    });
  });

  describe('completeCurrentMessage', () => {
    it('replaces the streaming bubble content + meta and flips isStreaming false', () => {
      useAiStore.getState().startAssistantMessage();

      useAiStore.getState().completeCurrentMessage('hello world', 'conv-7', {
        tokensUsed: 42,
        monthlyBudgetRemaining: 9000,
        usageWarning: null,
        providerStatus: 'ok',
      });

      const state = useAiStore.getState();
      expect(state.messages[0]).toMatchObject({
        content: 'hello world',
        streaming: false,
        providerStatus: 'ok',
      });
      expect(state.conversationId).toBe('conv-7');
      expect(state.isStreaming).toBe(false);
      expect(state.providerAvailable).toBe(true);
    });

    it('flips providerAvailable false when providerStatus is unavailable', () => {
      useAiStore.getState().startAssistantMessage();

      useAiStore.getState().completeCurrentMessage('fallback content', 'conv-1', {
        tokensUsed: 0,
        monthlyBudgetRemaining: 9999,
        usageWarning: null,
        providerStatus: 'unavailable',
      });

      expect(useAiStore.getState().providerAvailable).toBe(false);
    });
  });

  describe('setError', () => {
    it('sets the error string and clears isStreaming', () => {
      useAiStore.setState({ isStreaming: true });
      useAiStore.getState().setError('AI is down');

      expect(useAiStore.getState().error).toBe('AI is down');
      expect(useAiStore.getState().isStreaming).toBe(false);
    });
  });

  describe('loadUsage', () => {
    it('flips isLoadingUsage true mid-flight and folds the response into usage', async () => {
      let midFlight: boolean | undefined;
      mockGet.mockImplementationOnce(() => {
        midFlight = useAiStore.getState().isLoadingUsage;
        return Promise.resolve({ data: { success: true, data: sampleUsage } });
      });

      await useAiStore.getState().loadUsage();

      expect(midFlight).toBe(true);
      expect(mockGet).toHaveBeenCalledWith('/ai/usage');
      expect(useAiStore.getState().usage).toEqual(sampleUsage);
      expect(useAiStore.getState().isLoadingUsage).toBe(false);
    });

    it('clears isLoadingUsage on error and leaves usage null', async () => {
      mockGet.mockRejectedValueOnce(new Error('network down'));

      await useAiStore.getState().loadUsage();

      expect(useAiStore.getState().usage).toBeNull();
      expect(useAiStore.getState().isLoadingUsage).toBe(false);
    });
  });

  describe('clearConversation', () => {
    it('DELETEs /ai/conversation/:id when conversationId is present and resets messages', async () => {
      useAiStore.setState({
        conversationId: 'conv-9',
        messages: [
          {
            id: 'a',
            role: 'user',
            content: 'hi',
            streaming: false,
            timestamp: '',
            usageWarning: null,
            providerStatus: 'ok',
          },
        ],
        error: 'stale',
      });
      mockDelete.mockResolvedValueOnce({ data: { success: true } });

      await useAiStore.getState().clearConversation();

      expect(mockDelete).toHaveBeenCalledWith('/ai/conversation/conv-9');
      const state = useAiStore.getState();
      expect(state.messages).toEqual([]);
      expect(state.conversationId).toBeNull();
      expect(state.error).toBeNull();
    });

    it('skips the DELETE when conversationId is null and still clears local state', async () => {
      useAiStore.setState({
        conversationId: null,
        messages: [
          {
            id: 'a',
            role: 'user',
            content: 'hi',
            streaming: false,
            timestamp: '',
            usageWarning: null,
            providerStatus: 'ok',
          },
        ],
      });

      await useAiStore.getState().clearConversation();

      expect(mockDelete).not.toHaveBeenCalled();
      expect(useAiStore.getState().messages).toEqual([]);
    });

    it('still clears local state when the DELETE rejects (already gone)', async () => {
      useAiStore.setState({ conversationId: 'conv-x' });
      mockDelete.mockRejectedValueOnce(new Error('404'));

      await useAiStore.getState().clearConversation();

      expect(useAiStore.getState().conversationId).toBeNull();
      expect(useAiStore.getState().messages).toEqual([]);
    });
  });

  describe('sendMessage', () => {
    it('adds user message, starts assistant bubble, and emits AI_MESSAGE over the websocket', () => {
      useAiStore.setState({ conversationId: 'conv-3' });

      useAiStore.getState().sendMessage('how is my network?');

      const state = useAiStore.getState();
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0]).toMatchObject({ role: 'user', content: 'how is my network?' });
      expect(state.messages[1]).toMatchObject({ role: 'assistant', streaming: true });
      expect(state.isStreaming).toBe(true);

      expect(emitSpy).toHaveBeenCalledWith(WS_EVENTS.AI_MESSAGE, {
        content: 'how is my network?',
        conversationId: 'conv-3',
      });
    });

    it('is a no-op while isStreaming is true', () => {
      useAiStore.setState({ isStreaming: true });

      useAiStore.getState().sendMessage('ignored');

      expect(emitSpy).not.toHaveBeenCalled();
      expect(useAiStore.getState().messages).toEqual([]);
    });
  });

  describe('retryLastMessage', () => {
    it('finds the last user message, drops the empty streaming assistant bubble, clears error, and re-emits', () => {
      useAiStore.setState({
        conversationId: 'conv-5',
        messages: [
          {
            id: 'u1',
            role: 'user',
            content: 'first attempt',
            streaming: false,
            timestamp: '',
            usageWarning: null,
            providerStatus: 'ok',
          },
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            streaming: true,
            timestamp: '',
            usageWarning: null,
            providerStatus: 'ok',
          },
        ],
        error: 'AI service unavailable',
        isStreaming: false,
      });

      useAiStore.getState().retryLastMessage();

      const state = useAiStore.getState();
      // Empty streaming bubble removed, fresh streaming bubble added
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0]).toMatchObject({ role: 'user', content: 'first attempt' });
      expect(state.messages[1]).toMatchObject({ role: 'assistant', content: '', streaming: true });
      // The retry's fresh bubble is a different message object than the one we dropped
      expect(state.messages[1].id).not.toBe('a1');
      expect(state.error).toBeNull();
      expect(state.isStreaming).toBe(true);
      expect(emitSpy).toHaveBeenCalledWith(WS_EVENTS.AI_MESSAGE, {
        content: 'first attempt',
        conversationId: 'conv-5',
      });
    });

    it('preserves a partial-content assistant bubble — only drops fully empty streaming ones', () => {
      // If a streaming bubble already received some tokens before the error,
      // the user might want to see what was emitted. The retry strips only
      // the never-started streaming bubble; partial content stays in the
      // transcript above the new attempt.
      useAiStore.setState({
        messages: [
          {
            id: 'u1',
            role: 'user',
            content: 'q',
            streaming: false,
            timestamp: '',
            usageWarning: null,
            providerStatus: 'ok',
          },
          {
            id: 'a1',
            role: 'assistant',
            content: 'partial response received',
            streaming: true,
            timestamp: '',
            usageWarning: null,
            providerStatus: 'ok',
          },
        ],
        error: 'connection dropped',
      });

      useAiStore.getState().retryLastMessage();

      const state = useAiStore.getState();
      // Partial bubble kept; new streaming bubble appended after it.
      expect(state.messages).toHaveLength(3);
      expect(state.messages[1]).toMatchObject({
        id: 'a1',
        content: 'partial response received',
      });
      expect(state.messages[2]).toMatchObject({
        role: 'assistant',
        content: '',
        streaming: true,
      });
    });

    it('is a no-op while isStreaming is true', () => {
      useAiStore.setState({
        isStreaming: true,
        messages: [
          {
            id: 'u1',
            role: 'user',
            content: 'q',
            streaming: false,
            timestamp: '',
            usageWarning: null,
            providerStatus: 'ok',
          },
        ],
      });

      useAiStore.getState().retryLastMessage();

      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('is a no-op when no user message exists yet', () => {
      useAiStore.setState({ messages: [], error: 'something' });

      useAiStore.getState().retryLastMessage();

      expect(emitSpy).not.toHaveBeenCalled();
      // Error stays — there's nothing to retry, so clearing it would hide
      // the user's reason to act
      expect(useAiStore.getState().error).toBe('something');
    });
  });

  describe('findLastUserContent (pure helper)', () => {
    const msg = (role: 'user' | 'assistant', content: string) => ({
      id: content,
      role,
      content,
      streaming: false,
      timestamp: '',
      usageWarning: null,
      providerStatus: 'ok' as const,
    });

    it('returns the content of the most recent user message', () => {
      expect(
        findLastUserContent([
          msg('user', 'first'),
          msg('assistant', 'reply'),
          msg('user', 'second'),
          msg('assistant', 'reply2'),
        ]),
      ).toBe('second');
    });

    it('returns null when there are no user messages', () => {
      expect(findLastUserContent([msg('assistant', 'only assistant')])).toBeNull();
    });

    it('returns null for an empty transcript', () => {
      expect(findLastUserContent([])).toBeNull();
    });
  });
});
