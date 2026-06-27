export const NETWORK_CONTEXT_PROVIDER = Symbol('NETWORK_CONTEXT_PROVIDER');
export const REALTIME_CONTEXT_PROVIDER = Symbol('REALTIME_CONTEXT_PROVIDER');
export const ACCOUNT_CONTEXT_PROVIDER = Symbol('ACCOUNT_CONTEXT_PROVIDER');
export const PRODUCT_CONTEXT_PROVIDER = Symbol('PRODUCT_CONTEXT_PROVIDER');
export const RAG_CONTEXT_PROVIDER = Symbol('RAG_CONTEXT_PROVIDER');

/**
 * Retrieval seam for grounding the assistant in org-specific knowledge (runbooks, vendor KBs,
 * incident notes) — the Phase-2 RAG entry point from docs/design/local-ai-and-voice.md. Returns
 * a ready-to-inject prompt section (e.g. "## Relevant runbooks\n…") for the user's question, or
 * '' when there's nothing to add. The default implementation is a no-op; a pgvector-backed
 * retriever drops in here without touching the prompt-assembly or adapter/streaming paths.
 */
export interface RagContextProvider {
  getContext(
    organizationId: string,
    userId: string,
    userQuestion: string,
    activeDeviceIds?: string[],
  ): Promise<string>;
}
