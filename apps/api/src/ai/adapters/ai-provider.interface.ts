export const AI_PROVIDER_TOKEN = Symbol('AI_PROVIDER');

export interface AiCompletionPayload {
  systemPrompt: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userMessage: string;
}

export interface AiResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiProviderAdapter {
  complete(payload: AiCompletionPayload): Promise<AiResponse>;
  stream(payload: AiCompletionPayload, onChunk: (token: string) => void): Promise<AiResponse>;
  /**
   * Optional liveness probe for availability-aware provider selection (prefer a local model only when
   * it's actually running). Implemented by the local/OpenAI-compatible adapter; absent on adapters
   * whose availability can't be cheaply checked without a billable call (e.g. Claude).
   */
  isAvailable?(): Promise<boolean>;
}
