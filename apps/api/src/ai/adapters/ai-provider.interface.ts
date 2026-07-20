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
   * Liveness probe. Optional on the interface so a test double can omit it.
   *
   * NOTE: nothing calls this yet. `AiService` relies on its graceful-degradation
   * path instead, so an unreachable model server surfaces as the canned
   * network-aware fallback rather than an error. Wire this up if the client ever
   * needs to distinguish "no model configured" from "model is down".
   */
  isAvailable?(): Promise<boolean>;
}
