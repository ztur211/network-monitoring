import { OpenAICompatibleAdapter } from '../openai-compatible.adapter';

/**
 * Unit tests for the OpenAI-compatible adapter (selected when AI_PROVIDER points
 * at an OpenAI-style endpoint, e.g. a local Ollama). Mocks global fetch — the only
 * branchy logic is response mapping and the SSE stream parser. Throwing on a
 * non-OK / bodyless response is correct: AiService catches it and returns the
 * documented graceful fallback.
 */
const encoder = new TextEncoder();

/** A minimal ReadableStream reader that yields the given string chunks in order. */
function makeReader(chunks: string[]) {
  let i = 0;
  return {
    read: jest.fn().mockImplementation(async () => {
      if (i < chunks.length) {
        return { done: false, value: encoder.encode(chunks[i++]) };
      }
      return { done: true, value: undefined };
    }),
  };
}

describe('OpenAICompatibleAdapter', () => {
  let adapter: OpenAICompatibleAdapter;

  beforeEach(() => {
    adapter = new OpenAICompatibleAdapter();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => jest.clearAllMocks());

  describe('complete', () => {
    it('maps a normal completion response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello there' } }],
          usage: { prompt_tokens: 12, completion_tokens: 4 },
        }),
      });

      const result = await adapter.complete({
        systemPrompt: 'system',
        history: [{ role: 'user', content: 'earlier' }],
        userMessage: 'hi',
      });

      expect(result).toEqual({ content: 'Hello there', inputTokens: 12, outputTokens: 4 });

      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toMatch(/\/chat\/completions$/);
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(opts.headers.Authorization).toMatch(/^Bearer /);
      const body = JSON.parse(opts.body);
      expect(body.max_tokens).toBe(1024);
      expect(body.messages[0]).toEqual({ role: 'system', content: 'system' });
      expect(body.messages).toContainEqual({ role: 'user', content: 'earlier' });
      expect(body.messages[body.messages.length - 1]).toEqual({ role: 'user', content: 'hi' });
    });

    it('throws when the response is not ok', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 502 });

      await expect(
        adapter.complete({ systemPrompt: 's', history: [], userMessage: 'hi' }),
      ).rejects.toThrow(/502/);
    });

    it('returns empty content when choices is empty', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 0 } }),
      });

      const result = await adapter.complete({ systemPrompt: 's', history: [], userMessage: 'hi' });
      expect(result.content).toBe('');
    });
  });

  describe('stream', () => {
    it('accumulates SSE tokens and skips [DONE] and malformed lines', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
        'data: not-valid-json\n', // malformed → skipped, must not throw
        'data: [DONE]\n', // sentinel → skipped
      ];
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        body: { getReader: () => makeReader(chunks) },
      });

      const tokens: string[] = [];
      const result = await adapter.stream(
        { systemPrompt: 'sys', history: [], userMessage: 'hi there' },
        (t) => tokens.push(t),
      );

      expect(tokens).toEqual(['Hel', 'lo']);
      expect(result.content).toBe('Hello');
      // OpenAI streaming returns no token counts; the adapter approximates len/4.
      expect(result.inputTokens).toBe(Math.ceil('hi there'.length / 4));
      expect(result.outputTokens).toBe(Math.ceil('Hello'.length / 4));

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.stream).toBe(true);
    });

    it('throws when the stream response is not ok', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, body: makeReader([]) });

      await expect(
        adapter.stream({ systemPrompt: 's', history: [], userMessage: 'hi' }, () => undefined),
      ).rejects.toThrow(/500/);
    });

    it('throws when the response body is null', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, body: null });

      await expect(
        adapter.stream({ systemPrompt: 's', history: [], userMessage: 'hi' }, () => undefined),
      ).rejects.toThrow();
    });
  });
});
