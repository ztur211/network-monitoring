import Anthropic from '@anthropic-ai/sdk';
import { AiCompletionPayload, AiProviderAdapter, AiResponse } from './ai-provider.interface';

const MODEL = 'claude-sonnet-4-6';
const MAX_OUTPUT_TOKENS = 1024;

type MessageParam = { role: 'user' | 'assistant'; content: string };

function buildMessages(payload: AiCompletionPayload): MessageParam[] {
  return [
    ...payload.history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: payload.userMessage },
  ];
}

export class ClaudeAdapter implements AiProviderAdapter {
  private readonly client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async complete(payload: AiCompletionPayload): Promise<AiResponse> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: payload.systemPrompt,
      messages: buildMessages(payload),
    });

    const content =
      response.content[0]?.type === 'text' ? response.content[0].text : '';

    return {
      content,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  async stream(
    payload: AiCompletionPayload,
    onChunk: (token: string) => void,
  ): Promise<AiResponse> {
    let content = '';

    const stream = this.client.messages.stream({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: payload.systemPrompt,
      messages: buildMessages(payload),
    });

    stream.on('text', (text: string) => {
      content += text;
      onChunk(text);
    });

    const finalMessage = await stream.finalMessage();

    return {
      content,
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    };
  }
}
