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
});
