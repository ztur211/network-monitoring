/**
 * Shared token-budget helpers for AI context assembly.
 *
 * Token counts here are a cheap heuristic (~4 characters per token) rather than
 * a real tokenizer - good enough to bound prompt size without a billable
 * count_tokens round-trip to the provider. Both the context providers (bounding
 * a single section) and AiService (bounding the whole system prompt) use these
 * so the estimate is consistent everywhere.
 */

const CHARS_PER_TOKEN = 4;

/** Default marker appended when a context section is cut short. */
export const CONTEXT_TRUNCATION_MARKER = '\n... (context truncated)';

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Hard-bounds `text` to `maxTokens`, appending a visible marker so the model
 * knows the content is partial. Returns `text` unchanged when it already fits.
 *
 * The returned string is guaranteed not to exceed `maxTokens` (marker included):
 * a single pathological field - e.g. a device with a novel pasted into `notes` -
 * therefore cannot blow the budget even if it slips past upstream row caps.
 */
export function truncateToTokenBudget(
  text: string,
  maxTokens: number,
  marker: string = CONTEXT_TRUNCATION_MARKER,
): string {
  if (estimateTokenCount(text) <= maxTokens) return text;
  // Reserve room for the marker so the final string still fits the budget.
  const maxChars = Math.max(0, maxTokens * CHARS_PER_TOKEN - marker.length);
  return text.slice(0, maxChars) + marker;
}
