export interface AiMessageResponseDto {
  content: string;
  conversationId: string;
  tokensUsed: number;
  monthlyBudgetRemaining: number;
  usageWarning: string | null;
  providerStatus: 'ok' | 'unavailable';
}

export interface AiUsageDto {
  hourlyUsed: number;
  hourlyLimit: number;
  dailyUsed: number;
  dailyLimit: number;
  monthlyTokensUsed: number;
  monthlyTokenBudget: number;
  resetsAt: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}
