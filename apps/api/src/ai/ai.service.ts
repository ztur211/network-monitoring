import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  AiMessageResponseDto,
  AiUsageDto,
  OnboardingProgress,
  OnboardingStepId,
} from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { AI_PROVIDER_TOKEN, AiProviderAdapter } from './adapters/ai-provider.interface';
import { ContextBuilderService } from './context/context-builder.service';
import { AiRateLimiterService } from './rate-limiting/ai-rate-limiter.service';
import { ConversationService } from './conversation/conversation.service';
import { SendAiMessageDto } from './ai.dto';

const ONBOARDING_MESSAGE_MAX_CHARS = 300;

const ONBOARDING_FALLBACKS: Record<OnboardingStepId, string> = {
  welcome: "Welcome to NodeScope! Let's get your home network set up.",
  networkName: 'What would you like to call this network?',
  address:
    "What's the address where this network lives? You can skip if you'd rather not say.",
  browserDeviceName: 'Give this browser a name so you can spot it on the map.',
  mobility: 'Does this browser ever leave home, or stay on this network?',
  confirmHomeIp:
    "I can see your current public IP. Use it as the home IP for this network?",
  routerMac: "Have a router MAC handy? Otherwise skip — we'll add it later.",
  modemMac: "Have a modem MAC handy? Otherwise skip — we'll add it later.",
  isp: 'Which ISP provides this connection?',
  speeds: 'Roughly how fast is the plan, in Mbps?',
  done: "All set! Your home network is on the map.",
};

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
      response = this.buildSuccessEnvelope(
        conversationId,
        adapterResponse.content,
        totalTokens,
        usage,
      );
    } catch (err) {
      if (err instanceof NodeScopeException) throw err;

      this.logger.warn({ err }, 'AI provider unavailable — returning fallback response');
      const fallback = this.buildFallbackResponse(systemPrompt);

      const usage = await this.rateLimiter.getUsageCounts(userId);
      response = this.buildFallbackEnvelope(conversationId, fallback, usage);
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
      return this.buildSuccessEnvelope(
        conversationId,
        adapterResponse.content,
        totalTokens,
        usage,
      );
    } catch (err) {
      if (err instanceof NodeScopeException) throw err;

      this.logger.warn({ err }, 'AI provider unavailable during stream — returning fallback');
      const fallback = this.buildFallbackResponse(systemPrompt);
      onToken(fallback, conversationId);

      const usage = await this.rateLimiter.getUsageCounts(userId);
      return this.buildFallbackEnvelope(conversationId, fallback, usage);
    }
  }

  async getUsage(userId: string): Promise<AiUsageDto> {
    return this.rateLimiter.getUsageCounts(userId);
  }

  async deleteConversation(conversationId: string): Promise<boolean> {
    return this.conversation.deleteConversation(conversationId);
  }

  /**
   * Generates a short, friendly onboarding chat message for the given step.
   *
   * Shares the standard six-layer AI rate limiter with the main chat — the
   * plan called for a separate `ai:onboarding:{userId}` bucket but that
   * would require teaching AiRateLimiterService about bucket prefixes, and
   * a one-time ~10-message wizard isn't enough volume to justify that
   * refactor in MVP. Onboarding messages count against the same quota as
   * regular AI use.
   *
   * Returns `providerStatus: 'unavailable'` and a hardcoded per-step
   * fallback if the AI provider call fails — the wizard must keep
   * advancing even when the AI is down (graceful-degradation Option 2 from
   * CLAUDE.md). Rate-limit exceptions still bubble up so the wizard can
   * back off.
   */
  async generateOnboardingMessage(
    userId: string,
    ip: string,
    step: OnboardingStepId,
    progress: OnboardingProgress,
    userMessage?: string,
  ): Promise<{ content: string; providerStatus: 'ok' | 'unavailable'; tokensUsed: number }> {
    await this.rateLimiter.checkRateLimits(userId, ip);

    const systemPrompt = this.buildOnboardingSystemPrompt(step, progress);

    try {
      const adapterResponse = await this.adapter.complete({
        systemPrompt,
        history: [],
        userMessage: userMessage ?? '',
      });

      const content = adapterResponse.content.slice(0, ONBOARDING_MESSAGE_MAX_CHARS);
      const totalTokens = adapterResponse.inputTokens + adapterResponse.outputTokens;
      await this.rateLimiter.incrementUsage(userId, totalTokens);

      return { content, providerStatus: 'ok', tokensUsed: totalTokens };
    } catch (err) {
      if (err instanceof NodeScopeException) throw err;
      this.logger.warn({ err, step }, 'AI provider unavailable for onboarding — using hardcoded fallback');
      return {
        content: ONBOARDING_FALLBACKS[step],
        providerStatus: 'unavailable',
        tokensUsed: 0,
      };
    }
  }

  /**
   * Builds the success response envelope for a completed AI exchange, deriving
   * the usage warning and remaining monthly budget from the usage counts.
   */
  private buildSuccessEnvelope(
    conversationId: string,
    content: string,
    tokensUsed: number,
    usage: AiUsageDto,
  ): AiMessageResponseDto {
    return {
      content,
      conversationId,
      tokensUsed,
      monthlyBudgetRemaining: Math.max(0, usage.monthlyTokenBudget - usage.monthlyTokensUsed),
      usageWarning: this.rateLimiter.buildUsageWarning({
        hourlyUsed: usage.hourlyUsed,
        dailyUsed: usage.dailyUsed,
        monthlyTokensUsed: usage.monthlyTokensUsed,
      }),
      providerStatus: 'ok',
    };
  }

  /**
   * Builds the graceful-degradation response envelope used when the AI
   * provider is unavailable: no tokens charged, no usage warning, and
   * providerStatus 'unavailable' (see CLAUDE.md graceful-degradation Option 2).
   */
  private buildFallbackEnvelope(
    conversationId: string,
    content: string,
    usage: AiUsageDto,
  ): AiMessageResponseDto {
    return {
      content,
      conversationId,
      tokensUsed: 0,
      monthlyBudgetRemaining: Math.max(0, usage.monthlyTokenBudget - usage.monthlyTokensUsed),
      usageWarning: null,
      providerStatus: 'unavailable',
    };
  }

  private buildOnboardingSystemPrompt(step: OnboardingStepId, progress: OnboardingProgress): string {
    const knowns: string[] = [];
    if (progress.networkName) knowns.push(`network name: ${progress.networkName}`);
    if (progress.homeAddress) knowns.push(`address: ${progress.homeAddress}`);
    if (progress.browserDeviceName) knowns.push(`device name: ${progress.browserDeviceName}`);
    if (progress.mobility) knowns.push(`mobility: ${progress.mobility}`);
    if (progress.isp) knowns.push(`ISP: ${progress.isp}`);

    return [
      `You are a friendly setup assistant for NodeScope, a home network map tool.`,
      `The user is on the "${step}" step of a 10-step wizard.`,
      knowns.length > 0 ? `Already collected: ${knowns.join(', ')}.` : `Nothing collected yet.`,
      `Write ONE short prompt (<=${ONBOARDING_MESSAGE_MAX_CHARS} characters) to ask for the next field for this step.`,
      `Be warm, brief, and direct. Do not mention NodeScope by name unless on the welcome step. No markdown.`,
    ].join(' ');
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
