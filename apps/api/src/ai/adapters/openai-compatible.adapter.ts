import { AiCompletionPayload, AiProviderAdapter, AiResponse } from './ai-provider.interface';

const MAX_OUTPUT_TOKENS = 1024;

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

export class OpenAICompatibleAdapter implements AiProviderAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    this.baseUrl = process.env.AI_BASE_URL ?? 'http://localhost:11434/v1';
    this.apiKey = process.env.AI_API_KEY ?? 'ollama';
    this.model = process.env.AI_MODEL ?? 'llama3';
  }

  async complete(payload: AiCompletionPayload): Promise<AiResponse> {
    const messages = buildMessages(payload);

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, messages, max_tokens: MAX_OUTPUT_TOKENS }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI-compatible API error: ${res.status}`);
    }

    const body = (await res.json()) as OpenAiResponse;
    return {
      content: body.choices[0]?.message.content ?? '',
      inputTokens: body.usage.prompt_tokens,
      outputTokens: body.usage.completion_tokens,
    };
  }

  async stream(
    payload: AiCompletionPayload,
    onChunk: (token: string) => void,
  ): Promise<AiResponse> {
    const messages = buildMessages(payload);

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: true,
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`OpenAI-compatible stream error: ${res.status}`);
    }

    let content = '';
    const reader = res.body.getReader();
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
  }
}
