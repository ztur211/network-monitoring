import { HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AiService } from '../ai.service';
import { ContextBuilderService } from '../context/context-builder.service';
import { AiRateLimiterService } from '../rate-limiting/ai-rate-limiter.service';
import { ConversationService } from '../conversation/conversation.service';
import { AI_PROVIDER_TOKEN } from '../adapters/ai-provider.interface';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

const mockAdapter = {
  complete: jest.fn(),
  stream: jest.fn(),
};

const mockContextBuilder = {
  buildSystemPrompt: jest.fn().mockResolvedValue('You are an AI assistant.'),
  estimateTokenCount: jest.fn().mockReturnValue(500),
};

const mockRateLimiter = {
  checkRateLimits: jest.fn().mockResolvedValue(undefined),
  incrementUsage: jest.fn().mockResolvedValue(undefined),
  buildUsageWarning: jest.fn().mockReturnValue(null),
  getUsageCounts: jest.fn(),
};

const mockConversation = {
  getHistory: jest.fn().mockResolvedValue([]),
  appendMessages: jest.fn().mockResolvedValue(undefined),
  deleteConversation: jest.fn().mockResolvedValue(true),
  createConversationId: jest.fn().mockReturnValue('new-conv-id'),
};

describe('AiService', () => {
  let service: AiService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: AI_PROVIDER_TOKEN, useValue: mockAdapter },
        { provide: ContextBuilderService, useValue: mockContextBuilder },
        { provide: AiRateLimiterService, useValue: mockRateLimiter },
        { provide: ConversationService, useValue: mockConversation },
      ],
    }).compile();

    service = module.get(AiService);
    jest.clearAllMocks();

    mockContextBuilder.buildSystemPrompt.mockResolvedValue('System prompt.');
    mockContextBuilder.estimateTokenCount.mockReturnValue(500);
    mockRateLimiter.checkRateLimits.mockResolvedValue(undefined);
    mockRateLimiter.incrementUsage.mockResolvedValue(undefined);
    mockRateLimiter.buildUsageWarning.mockReturnValue(null);
    mockConversation.getHistory.mockResolvedValue([]);
    mockConversation.appendMessages.mockResolvedValue(undefined);
    mockConversation.deleteConversation.mockResolvedValue(true);
    mockConversation.createConversationId.mockReturnValue('new-conv-id');
  });

  describe('sendMessageHttp', () => {
    it('returns AI response with conversationId and usage data', async () => {
      mockAdapter.complete.mockResolvedValue({
        content: 'Your router appears healthy.',
        inputTokens: 300,
        outputTokens: 50,
      });
      mockRateLimiter.getUsageCounts.mockResolvedValue({
        hourlyUsed: 1, hourlyLimit: 20,
        dailyUsed: 1, dailyLimit: 100,
        monthlyTokensUsed: 350, monthlyTokenBudget: 100000,
        resetsAt: '2026-06-01T00:00:00.000Z',
      });

      const result = await service.sendMessageHttp('user-1', 'PERSONAL_FREE', '127.0.0.1', {
        content: 'Is my router okay?',
      });

      expect(result.content).toBe('Your router appears healthy.');
      expect(result.conversationId).toBe('new-conv-id');
      expect(result.tokensUsed).toBe(350);
      expect(result.providerStatus).toBe('ok');
    });

    it('throws NodeScopeException when rate limit check fails', async () => {
      mockRateLimiter.checkRateLimits.mockRejectedValue(
        new NodeScopeException('AI_001', 'AI_RATE_LIMIT_HOURLY', 429),
      );

      await expect(
        service.sendMessageHttp('user-1', 'PERSONAL_FREE', '127.0.0.1', { content: 'hi' }),
      ).rejects.toThrow(NodeScopeException);

      expect(mockAdapter.complete).not.toHaveBeenCalled();
    });

    it('returns fallback response when adapter throws', async () => {
      mockAdapter.complete.mockRejectedValue(new Error('Connection refused'));
      mockRateLimiter.getUsageCounts.mockResolvedValue({
        hourlyUsed: 1, hourlyLimit: 20,
        dailyUsed: 1, dailyLimit: 100,
        monthlyTokensUsed: 0, monthlyTokenBudget: 100000,
        resetsAt: '2026-06-01T00:00:00.000Z',
      });

      const result = await service.sendMessageHttp('user-1', 'PERSONAL_FREE', '127.0.0.1', {
        content: 'What devices do I have?',
      });

      expect(result.providerStatus).toBe('unavailable');
      expect(result.tokensUsed).toBe(0);
      expect(result.content).toBeTruthy();
      expect(mockConversation.appendMessages).not.toHaveBeenCalled();
    });

    it('stores conversation history after successful response', async () => {
      mockAdapter.complete.mockResolvedValue({ content: 'Hi!', inputTokens: 100, outputTokens: 10 });
      mockRateLimiter.getUsageCounts.mockResolvedValue({
        hourlyUsed: 1, hourlyLimit: 20, dailyUsed: 1, dailyLimit: 100,
        monthlyTokensUsed: 110, monthlyTokenBudget: 100000, resetsAt: '2026-06-01T00:00:00.000Z',
      });

      await service.sendMessageHttp('user-1', 'PERSONAL_FREE', '127.0.0.1', { content: 'Hello' });

      expect(mockConversation.appendMessages).toHaveBeenCalledWith('new-conv-id', 'Hello', 'Hi!');
    });

    it('increments usage counters after successful response', async () => {
      mockAdapter.complete.mockResolvedValue({ content: 'Ok', inputTokens: 200, outputTokens: 30 });
      mockRateLimiter.getUsageCounts.mockResolvedValue({
        hourlyUsed: 1, hourlyLimit: 20, dailyUsed: 1, dailyLimit: 100,
        monthlyTokensUsed: 230, monthlyTokenBudget: 100000, resetsAt: '2026-06-01T00:00:00.000Z',
      });

      await service.sendMessageHttp('user-1', 'PERSONAL_FREE', '127.0.0.1', { content: 'Test' });

      expect(mockRateLimiter.incrementUsage).toHaveBeenCalledWith('user-1', 230);
    });

    it('continues an existing conversation when conversationId is provided', async () => {
      mockConversation.getHistory.mockResolvedValue([
        { role: 'user', content: 'Previous question' },
        { role: 'assistant', content: 'Previous answer' },
      ]);
      mockAdapter.complete.mockResolvedValue({ content: 'Follow-up answer', inputTokens: 400, outputTokens: 60 });
      mockRateLimiter.getUsageCounts.mockResolvedValue({
        hourlyUsed: 2, hourlyLimit: 20, dailyUsed: 2, dailyLimit: 100,
        monthlyTokensUsed: 460, monthlyTokenBudget: 100000, resetsAt: '2026-06-01T00:00:00.000Z',
      });

      const result = await service.sendMessageHttp('user-1', 'PERSONAL_FREE', '127.0.0.1', {
        content: 'Follow-up',
        conversationId: 'existing-conv',
      });

      expect(mockConversation.getHistory).toHaveBeenCalledWith('existing-conv');
      expect(result.conversationId).toBe('existing-conv');
    });
  });

  describe('getUsage', () => {
    it('returns usage counts with limits from rate limiter', async () => {
      mockRateLimiter.getUsageCounts.mockResolvedValue({
        hourlyUsed: 5, hourlyLimit: 20,
        dailyUsed: 10, dailyLimit: 100,
        monthlyTokensUsed: 5000, monthlyTokenBudget: 100000,
        resetsAt: '2026-06-01T00:00:00.000Z',
      });

      const result = await service.getUsage('user-1');
      expect(result.hourlyUsed).toBe(5);
      expect(result.dailyUsed).toBe(10);
      expect(result.monthlyTokensUsed).toBe(5000);
    });
  });

  describe('deleteConversation', () => {
    it('delegates to ConversationService and returns true when deleted', async () => {
      const result = await service.deleteConversation('conv-123');
      expect(mockConversation.deleteConversation).toHaveBeenCalledWith('conv-123');
      expect(result).toBe(true);
    });
  });

  describe('sendMessageStream', () => {
    const usageSnapshot = {
      hourlyUsed: 1, hourlyLimit: 20,
      dailyUsed: 1, dailyLimit: 100,
      monthlyTokensUsed: 350, monthlyTokenBudget: 100000,
      resetsAt: '2026-06-01T00:00:00.000Z',
    };

    it('invokes onToken for each streamed chunk and returns final response', async () => {
      mockAdapter.stream.mockImplementation(async (_req, onToken) => {
        onToken('Hello');
        onToken(' world');
        return { content: 'Hello world', inputTokens: 200, outputTokens: 20 };
      });
      mockRateLimiter.getUsageCounts.mockResolvedValue(usageSnapshot);

      const tokens: string[] = [];
      const conversationIds: string[] = [];
      const result = await service.sendMessageStream(
        'user-1',
        'PERSONAL_FREE',
        '127.0.0.1',
        { content: 'Hi' },
        (token, conversationId) => {
          tokens.push(token);
          conversationIds.push(conversationId);
        },
      );

      expect(tokens).toEqual(['Hello', ' world']);
      expect(conversationIds).toEqual(['new-conv-id', 'new-conv-id']);
      expect(result.content).toBe('Hello world');
      expect(result.providerStatus).toBe('ok');
      expect(result.tokensUsed).toBe(220);
    });

    it('re-throws NodeScopeException from rate limiter without calling adapter', async () => {
      mockRateLimiter.checkRateLimits.mockRejectedValue(
        new NodeScopeException('AI_001', 'AI_RATE_LIMIT_HOURLY', HttpStatus.TOO_MANY_REQUESTS),
      );

      const onToken = jest.fn();
      await expect(
        service.sendMessageStream('user-1', 'PERSONAL_FREE', '127.0.0.1', { content: 'hi' }, onToken),
      ).rejects.toThrow(NodeScopeException);

      expect(mockAdapter.stream).not.toHaveBeenCalled();
      expect(onToken).not.toHaveBeenCalled();
    });

    it('emits fallback via onToken when adapter throws mid-stream', async () => {
      mockAdapter.stream.mockImplementation(async (_req, onToken) => {
        onToken('partial');
        throw new Error('connection lost');
      });
      mockContextBuilder.buildSystemPrompt.mockResolvedValue(
        '## Documented Network\nRouter (ROUTER) at 1,2',
      );
      mockRateLimiter.getUsageCounts.mockResolvedValue(usageSnapshot);

      const tokens: string[] = [];
      const result = await service.sendMessageStream(
        'user-1', 'PERSONAL_FREE', '127.0.0.1', { content: 'hi' },
        (token) => tokens.push(token),
      );

      expect(result.providerStatus).toBe('unavailable');
      expect(result.tokensUsed).toBe(0);
      expect(tokens[0]).toBe('partial');
      expect(tokens[1]).toContain("temporarily unable to reach the AI service");
      expect(tokens[1]).toContain('Router (ROUTER)');
      // History MUST NOT be stored on fallback — conversation state is for real exchanges only
      expect(mockConversation.appendMessages).not.toHaveBeenCalled();
      expect(mockRateLimiter.incrementUsage).not.toHaveBeenCalled();
    });

    it('drops oldest history pairs when assembled tokens exceed budget', async () => {
      // 6 messages = 3 pairs of history
      mockConversation.getHistory.mockResolvedValue([
        { role: 'user', content: 'oldest q' },
        { role: 'assistant', content: 'oldest a' },
        { role: 'user', content: 'middle q' },
        { role: 'assistant', content: 'middle a' },
        { role: 'user', content: 'newest q' },
        { role: 'assistant', content: 'newest a' },
      ]);
      // Token estimator returns over-budget for first two calls, then under budget.
      // The implementation drops two messages (one pair) per iteration.
      mockContextBuilder.estimateTokenCount
        .mockReturnValueOnce(9000) // initial: too big
        .mockReturnValueOnce(8500) // after dropping oldest pair: still too big
        .mockReturnValue(7000); // after dropping middle pair: fits
      mockAdapter.stream.mockImplementation(async (req, _onToken) => {
        // capture trimmed history at the time of the call
        return { content: JSON.stringify(req.history), inputTokens: 1, outputTokens: 1 };
      });
      mockRateLimiter.getUsageCounts.mockResolvedValue(usageSnapshot);

      const result = await service.sendMessageStream(
        'user-1', 'PERSONAL_FREE', '127.0.0.1',
        { content: 'next' }, () => {},
      );

      // After dropping 2 pairs (4 messages), only the newest pair remains
      const passedHistory = JSON.parse(result.content);
      expect(passedHistory).toHaveLength(2);
      expect(passedHistory[0].content).toBe('newest q');
      expect(passedHistory[1].content).toBe('newest a');
    });

    it('fallback says "No devices documented yet" when systemPrompt has no Network section', async () => {
      mockAdapter.stream.mockRejectedValue(new Error('boom'));
      mockContextBuilder.buildSystemPrompt.mockResolvedValue(
        '## Account\nTier: PERSONAL_FREE\n\n## Product Knowledge\n...',
      );
      mockRateLimiter.getUsageCounts.mockResolvedValue(usageSnapshot);

      const tokens: string[] = [];
      const result = await service.sendMessageStream(
        'user-1', 'PERSONAL_FREE', '127.0.0.1',
        { content: 'hi' }, (t) => tokens.push(t),
      );

      expect(result.providerStatus).toBe('unavailable');
      expect(result.content).toContain('No devices documented yet');
    });

    it('reuses existing conversationId and forwards it to onToken', async () => {
      mockConversation.getHistory.mockResolvedValue([
        { role: 'user', content: 'prev q' },
        { role: 'assistant', content: 'prev a' },
      ]);
      mockAdapter.stream.mockImplementation(async (_req, onToken) => {
        onToken('reply');
        return { content: 'reply', inputTokens: 10, outputTokens: 5 };
      });
      mockRateLimiter.getUsageCounts.mockResolvedValue(usageSnapshot);

      const seen: string[] = [];
      const result = await service.sendMessageStream(
        'user-1', 'PERSONAL_FREE', '127.0.0.1',
        { content: 'follow', conversationId: 'existing' },
        (_t, id) => seen.push(id),
      );

      expect(mockConversation.getHistory).toHaveBeenCalledWith('existing');
      expect(seen).toEqual(['existing']);
      expect(result.conversationId).toBe('existing');
    });
  });
});
