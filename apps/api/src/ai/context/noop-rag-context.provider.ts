import { Injectable } from '@nestjs/common';
import { RagContextProvider } from './context-provider.interface';

/**
 * Default RAG provider: retrieves nothing, so the assistant behaves exactly as before this seam
 * existed. It's wired into the context chain so the Phase-2 pgvector-backed retriever (embed the
 * question via a local model → top-k over a per-org embeddings table → format as a prompt section)
 * is a drop-in replacement at the RAG_CONTEXT_PROVIDER token, with no change to ContextBuilder,
 * AiService, or the adapter/streaming path. See docs/design/local-ai-and-voice.md (Phase 2).
 */
@Injectable()
export class NoopRagContextProvider implements RagContextProvider {
  async getContext(
    _organizationId: string,
    _userId: string,
    _userQuestion: string,
    _activeDeviceIds?: string[],
  ): Promise<string> {
    return '';
  }
}
