/**
 * Graceful degradation: AI provider unavailable (SAD Section 11.8)
 *
 * Verifies: when the AI adapter throws any non-NodeScopeException error,
 * AiService returns a 200-equivalent fallback response with providerStatus: 'unavailable'
 * and tokensUsed: 0 — no raw error reaches the caller.
 */
import { Test } from '@nestjs/testing';
import { AiService } from '../../ai/ai.service';
import { ContextBuilderService } from '../../ai/context/context-builder.service';
import { AiRateLimiterService } from '../../ai/rate-limiting/ai-rate-limiter.service';
import { ConversationService } from '../../ai/conversation/conversation.service';
import { AI_PROVIDER_TOKEN } from '../../ai/adapters/ai-provider.interface';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

const MOCK_SYSTEM_PROMPT = `## Documented Network\n5 devices\n## Realtime Context\nlatency: 12ms`;

const mockAdapter = { complete: jest.fn(), stream: jest.fn() };
const mockContextBuilder = {
  buildSystemPrompt: jest.fn().mockResolvedValue(MOCK_SYSTEM_PROMPT),
  estimateTokenCount: jest.fn().mockReturnValue(200),
};
const mockRateLimiter = {
  checkRateLimits: jest.fn().mockResolvedValue(undefined),
  incrementUsage: jest.fn().mockResolvedValue(undefined),
  buildUsageWarning: jest.fn().mockReturnValue(null),
  getUsageCounts: jest.fn().mockResolvedValue({
    hourlyUsed: 1, hourlyLimit: 20,
    dailyUsed: 1, dailyLimit: 100,
    monthlyTokensUsed: 500, monthlyTokenBudget: 100_000,
  }),
};
const mockConversation = {
  getHistory: jest.fn().mockResolvedValue([]),
  appendMessages: jest.fn().mockResolvedValue(undefined),
  deleteConversation: jest.fn().mockResolvedValue(true),
  createConversationId: jest.fn().mockReturnValue('fallback-conv-id'),
};

describe('Graceful degradation — AI provider unavailable', () => {
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
    mockContextBuilder.buildSystemPrompt.mockResolvedValue(MOCK_SYSTEM_PROMPT);
    mockContextBuilder.estimateTokenCount.mockReturnValue(200);
    mockRateLimiter.checkRateLimits.mockResolvedValue(undefined);
    mockRateLimiter.buildUsageWarning.mockReturnValue(null);
    mockRateLimiter.getUsageCounts.mockResolvedValue({
      hourlyUsed: 1, hourlyLimit: 20,
      dailyUsed: 1, dailyLimit: 100,
      monthlyTokensUsed: 500, monthlyTokenBudget: 100_000,
    });
    mockConversation.getHistory.mockResolvedValue([]);
    mockConversation.createConversationId.mockReturnValue('fallback-conv-id');
  });

  it('returns providerStatus unavailable when the adapter throws a network error', async () => {
    mockAdapter.stream.mockRejectedValue(new Error('fetch failed: ECONNREFUSED'));

    const result = await service.sendMessageStream(
      'org-test',
      'user-1',
      'PERSONAL_FREE',
      '127.0.0.1',
      { content: 'Is my network healthy?' },
      () => {},
    );

    expect(result.providerStatus).toBe('unavailable');
    expect(result.tokensUsed).toBe(0);
    expect(result.content).toContain("I'm temporarily unable to reach the AI service");
    expect(result.content).toContain('5 devices');
  });

  it('returns providerStatus unavailable when the adapter throws a 503', async () => {
    const httpErr = Object.assign(new Error('Service Unavailable'), { status: 503 });
    mockAdapter.stream.mockRejectedValue(httpErr);

    const result = await service.sendMessageStream(
      'org-test',
      'user-1',
      'PERSONAL_FREE',
      '127.0.0.1',
      { content: 'What is my network topology?' },
      () => {},
    );

    expect(result.providerStatus).toBe('unavailable');
    expect(result.tokensUsed).toBe(0);
  });

  it('still throws NodeScopeException (rate limit) even when the adapter would fail', async () => {
    mockRateLimiter.checkRateLimits.mockRejectedValue(
      new NodeScopeException('AI_001', 'HOURLY_LIMIT_REACHED', 429),
    );

    await expect(
      service.sendMessageStream('org-test', 'user-1', 'PERSONAL_FREE', '127.0.0.1', { content: 'Hello' }, () => {}),
    ).rejects.toThrow(NodeScopeException);
  });

  it('stream path: emits fallback token and returns providerStatus unavailable', async () => {
    mockAdapter.stream.mockRejectedValue(new Error('Stream connection reset'));

    const tokens: string[] = [];
    const result = await service.sendMessageStream(
      'org-test',
      'user-1',
      'PERSONAL_FREE',
      '127.0.0.1',
      { content: 'Troubleshoot my connection' },
      (token: string) => tokens.push(token),
    );

    expect(result.providerStatus).toBe('unavailable');
    expect(result.tokensUsed).toBe(0);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0]).toContain("I'm temporarily unable to reach the AI service");
  });

  it('fallback content includes documented network summary from system prompt', async () => {
    mockContextBuilder.buildSystemPrompt.mockResolvedValue(
      '## Documented Network\n3 devices: Router, Switch, Firewall\n## Other Section\nstuff',
    );
    mockAdapter.stream.mockRejectedValue(new Error('timeout'));

    const result = await service.sendMessageStream(
      'org-test',
      'user-1',
      'PERSONAL_FREE',
      '127.0.0.1',
      { content: 'What devices do I have?' },
      () => {},
    );

    expect(result.content).toContain('3 devices: Router, Switch, Firewall');
  });
});
