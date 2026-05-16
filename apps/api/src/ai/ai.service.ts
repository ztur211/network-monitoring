import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AiMessageResponseDto, AiUsageDto } from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { AI_PROVIDER_TOKEN, AiProviderAdapter } from './adapters/ai-provider.interface';
import { ContextBuilderService } from './context/context-builder.service';
import { AiRateLimiterService } from './rate-limiting/ai-rate-limiter.service';
import { ConversationService } from './conversation/conversation.service';
import { SendAiMessageDto } from './ai.dto';

const MAX_INPUT_TOKENS = parseInt(process.env.AI_MAX_INPUT_TOKENS ?? '8000', 10);

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Inject(AI_PROVIDER_TOKEN) private readonly adapter: AiProviderAdapter,
    private readonly contextBuilder: ContextBuilderService,
    private readonly rateLimiter: AiRateLimiterService,
    private readonly conversation: ConversationService,
  ) {}

  async sendMessageHttp(
    userId: string,
    userTier: string,
    ip: string,
    dto: SendAiMessageDto,
  ): Promise<AiMessageResponseDto> {
    await this.rateLimiter.checkRateLimits(userId, ip);

    const conversationId = dto.conversationId ?? this.conversation.createConversationId();
    const [history, systemPrompt] = await Promise.all([
      this.conversation.getHistory(conversationId),
      this.contextBuilder.buildSystemPrompt(userId, userTier),
    ]);

    const trimmedHistory = this.trimHistoryToFitBudget(systemPrompt, history, dto.content);

    let response: AiMessageResponseDto;

    try {
      const adapterResponse = await this.adapter.complete({
        systemPrompt,
        history: trimmedHistory,
        userMessage: dto.content,
      });

      const totalTokens = adapterResponse.inputTokens + adapterResponse.outputTokens;
      await Promise.all([
        this.conversation.appendMessages(conversationId, dto.content, adapterResponse.content),
        this.rateLimiter.incrementUsage(userId, totalTokens),
      ]);

      const usage = await this.rateLimiter.getUsageCounts(userId);
      const usageWarning = this.rateLimiter.buildUsageWarning({
        hourlyUsed: usage.hourlyUsed,
        dailyUsed: usage.dailyUsed,
        monthlyTokensUsed: usage.monthlyTokensUsed,
      });

      response = {
        content: adapterResponse.content,
        conversationId,
        tokensUsed: totalTokens,
        monthlyBudgetRemaining: Math.max(0, usage.monthlyTokenBudget - usage.monthlyTokensUsed),
        usageWarning,
        providerStatus: 'ok',
      };
    } catch (err) {
      if (err instanceof NodeScopeException) throw err;

      this.logger.warn({ err }, 'AI provider unavailable — returning fallback response');
      const fallback = this.buildFallbackResponse(systemPrompt);

      const usage = await this.rateLimiter.getUsageCounts(userId);
      response = {
        content: fallback,
        conversationId,
        tokensUsed: 0,
        monthlyBudgetRemaining: Math.max(0, usage.monthlyTokenBudget - usage.monthlyTokensUsed),
        usageWarning: null,
        providerStatus: 'unavailable',
      };
    }

    return response;
  }

  async sendMessageStream(
    userId: string,
    userTier: string,
    ip: string,
    dto: SendAiMessageDto,
    onToken: (token: string, conversationId: string) => void,
  ): Promise<AiMessageResponseDto> {
    await this.rateLimiter.checkRateLimits(userId, ip);

    const conversationId = dto.conversationId ?? this.conversation.createConversationId();
    const [history, systemPrompt] = await Promise.all([
      this.conversation.getHistory(conversationId),
      this.contextBuilder.buildSystemPrompt(userId, userTier),
    ]);

    const trimmedHistory = this.trimHistoryToFitBudget(systemPrompt, history, dto.content);

    try {
      const adapterResponse = await this.adapter.stream(
        { systemPrompt, history: trimmedHistory, userMessage: dto.content },
        (token) => onToken(token, conversationId),
      );

      const totalTokens = adapterResponse.inputTokens + adapterResponse.outputTokens;
      await Promise.all([
        this.conversation.appendMessages(conversationId, dto.content, adapterResponse.content),
        this.rateLimiter.incrementUsage(userId, totalTokens),
      ]);

      const usage = await this.rateLimiter.getUsageCounts(userId);
      const usageWarning = this.rateLimiter.buildUsageWarning({
        hourlyUsed: usage.hourlyUsed,
        dailyUsed: usage.dailyUsed,
        monthlyTokensUsed: usage.monthlyTokensUsed,
      });

      return {
        content: adapterResponse.content,
        conversationId,
        tokensUsed: totalTokens,
        monthlyBudgetRemaining: Math.max(0, usage.monthlyTokenBudget - usage.monthlyTokensUsed),
        usageWarning,
        providerStatus: 'ok',
      };
    } catch (err) {
      if (err instanceof NodeScopeException) throw err;

      this.logger.warn({ err }, 'AI provider unavailable during stream — returning fallback');
      const fallback = this.buildFallbackResponse(systemPrompt);
      onToken(fallback, conversationId);

      const usage = await this.rateLimiter.getUsageCounts(userId);
      return {
        content: fallback,
        conversationId,
        tokensUsed: 0,
        monthlyBudgetRemaining: Math.max(0, usage.monthlyTokenBudget - usage.monthlyTokensUsed),
        usageWarning: null,
        providerStatus: 'unavailable',
      };
    }
  }

  async getUsage(userId: string): Promise<AiUsageDto> {
    return this.rateLimiter.getUsageCounts(userId);
  }

  async deleteConversation(conversationId: string): Promise<boolean> {
    return this.conversation.deleteConversation(conversationId);
  }

  private trimHistoryToFitBudget(
    systemPrompt: string,
    history: Array<{ role: string; content: string }>,
    userMessage: string,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    let trimmed = [...history] as Array<{ role: 'user' | 'assistant'; content: string }>;

    while (trimmed.length > 0) {
      const fullText = [systemPrompt, ...trimmed.map((m) => m.content), userMessage].join(' ');
      if (this.contextBuilder.estimateTokenCount(fullText) <= MAX_INPUT_TOKENS) break;
      // Drop the oldest pair (2 messages)
      trimmed = trimmed.slice(2);
    }

    return trimmed;
  }

  private buildFallbackResponse(systemPrompt: string): string {
    // Extract the network section from the assembled prompt for a useful fallback
    const networkMatch = /## Documented Network\n([\s\S]*?)(?=\n##|$)/.exec(systemPrompt);
    const networkSummary = networkMatch ? networkMatch[1].trim() : '';

    const lines = [
      "I'm temporarily unable to reach the AI service.",
      '',
      'Based on your documented network:',
    ];

    if (networkSummary) {
      lines.push(networkSummary);
    } else {
      lines.push('No devices documented yet.');
    }

    lines.push(
      '',
      'For troubleshooting steps, verify:',
      '1. All network hardware is powered on',
      '2. Physical cable connections are secure',
      '3. Check device indicator lights for error states',
      '4. Restart devices in order: modem → router → switches → access points',
      '',
      'The AI service will be available again shortly.',
    );

    return lines.join('\n');
  }
}
