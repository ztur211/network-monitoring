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
}
