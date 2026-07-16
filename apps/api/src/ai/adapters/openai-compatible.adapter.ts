import { AiCompletionPayload, AiProviderAdapter, AiResponse } from './ai-provider.interface';

const MAX_OUTPUT_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const AVAILABILITY_TIMEOUT_MS = 2_000;

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAiResponse {
  choices: Array<{ message: { content: string } }>;
  usage: { prompt_tokens: number; completion_tokens: number };
}

function buildMessages(payload: AiCompletionPayload): OpenAiMessage[] {
  return [
    { role: 'system', content: payload.systemPrompt },
    ...payload.history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: payload.userMessage },
  ];
}

/** Best-effort read of an error body for diagnostics — tolerant of mocked/bodyless responses. */
async function errorDetail(res: { text?: () => Promise<string> }): Promise<string> {
  if (typeof res.text !== 'function') return '';
  try {
    const body = (await res.text()).trim();
    return body ? ` — ${body.slice(0, 200)}` : '';
  } catch {
    return '';
  }
}

/**
 * Talks to any OpenAI-compatible chat endpoint — primarily a LOCAL model server (Ollama / llama.cpp /
 * LM Studio), which is the local-first AI path (see docs/design/local-ai-and-voice.md). Hardened for
 * local serving: a request timeout (a hung local model must not hang the request forever) and an
 * availability probe so provider selection can prefer the local model when it's actually up.
 */
export class OpenAICompatibleAdapter implements AiProviderAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor() {
    this.baseUrl = process.env.AI_BASE_URL ?? 'http://localhost:11434/v1';
    this.apiKey = process.env.AI_API_KEY ?? 'ollama';
    this.model = process.env.AI_MODEL ?? 'llama3';
    // Guard a misconfigured AI_TIMEOUT_MS: parseInt('abc') → NaN, and setTimeout(_, NaN) fires
    // immediately, which would abort every request. Fall back to the default on NaN/≤0.
    const t = parseInt(process.env.AI_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS), 10);
    this.timeoutMs = Number.isFinite(t) && t > 0 ? t : DEFAULT_TIMEOUT_MS;
  }

  async complete(payload: AiCompletionPayload): Promise<AiResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ model: this.model, messages: buildMessages(payload), max_tokens: MAX_OUTPUT_TOKENS }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        throw new Error(`OpenAI-compatible API error: ${res.status}${await errorDetail(res)}`);
      }

      const body = (await res.json()) as OpenAiResponse;
      return {
        content: body.choices[0]?.message.content ?? '',
        inputTokens: body.usage.prompt_tokens,
        outputTokens: body.usage.completion_tokens,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async stream(payload: AiCompletionPayload, onChunk: (token: string) => void): Promise<AiResponse> {
    // One wall-clock deadline covers connection setup AND body consumption. A peer that sends
    // headers and then stalls must not retain a reader, socket, prompt/history, and WS handler forever.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ model: this.model, messages: buildMessages(payload), max_tokens: MAX_OUTPUT_TOKENS, stream: true }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`OpenAI-compatible stream error: ${res.status}${await errorDetail(res)}`);
      }

      let content = '';
      reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          try {
            const data = JSON.parse(line.slice(6)) as {
              choices: Array<{ delta?: { content?: string } }>;
            };
            const token = data.choices[0]?.delta?.content;
            if (token) {
              content += token;
              onChunk(token);
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }

      // OpenAI streaming doesn't return token counts; approximate
      return {
        content,
        inputTokens: Math.ceil(payload.userMessage.length / 4),
        outputTokens: Math.ceil(content.length / 4),
      };
    } finally {
      clearTimeout(timer);
      ctrl.abort();
      if (typeof reader?.cancel === 'function') {
        await reader.cancel().catch(() => undefined);
      }
    }
  }

  /**
   * Cheap liveness probe (GET /models) so availability-aware provider selection can prefer the local
   * model only when it's actually running. Never throws — returns false on any error/timeout.
   */
  async isAvailable(): Promise<boolean> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AVAILABILITY_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers(), signal: ctrl.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` };
  }
}
