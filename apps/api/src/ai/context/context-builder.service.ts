import { Inject, Injectable } from '@nestjs/common';
import {
  NETWORK_CONTEXT_PROVIDER,
  REALTIME_CONTEXT_PROVIDER,
  ACCOUNT_CONTEXT_PROVIDER,
  PRODUCT_CONTEXT_PROVIDER,
  RAG_CONTEXT_PROVIDER,
  RagContextProvider,
} from './context-provider.interface';
import { NetworkContextProvider } from './network-context.provider';
import { RealtimeContextProvider } from './realtime-context.provider';
import { AccountContextProvider } from './account-context.provider';
import { ProductContextProvider } from './product-context.provider';
import { estimateTokenCount } from './token-budget';

const SYSTEM_PREAMBLE = `You are the NodeScope AI Assistant. You help users with two things: network troubleshooting and NodeScope usage guidance.

Your honesty boundaries (strictly follow these):
- Acknowledge when a question requires data you do not have.
- Distinguish "your device" (the browser session) from "your network" (all documented devices).
- Describe upcoming features as "planned" or "coming soon" — never as "available for purchase" or "available now".
- Be especially helpful during outages — your primary job is "what to do when things are broken".
- Never recommend features the user cannot access on their current tier without explaining the difference.
- If asked about real-time device status beyond what is in the Realtime Context section, acknowledge you cannot see that data.

`;

@Injectable()
export class ContextBuilderService {
  constructor(
    @Inject(NETWORK_CONTEXT_PROVIDER)
    private readonly networkProvider: NetworkContextProvider,
    @Inject(REALTIME_CONTEXT_PROVIDER)
    private readonly realtimeProvider: RealtimeContextProvider,
    @Inject(ACCOUNT_CONTEXT_PROVIDER)
    private readonly accountProvider: AccountContextProvider,
    @Inject(PRODUCT_CONTEXT_PROVIDER)
    private readonly productProvider: ProductContextProvider,
    @Inject(RAG_CONTEXT_PROVIDER)
    private readonly ragProvider: RagContextProvider,
  ) {}

  async buildSystemPrompt(
    organizationId: string,
    userId: string,
    userTier: string,
    userQuestion?: string,
    activeDeviceIds?: string[],
  ): Promise<string> {
    const [network, realtime, account, product, rag] = await Promise.all([
      this.networkProvider.getContext(organizationId, userId),
      this.realtimeProvider.getContext(organizationId, userId),
      this.accountProvider.getContext(userId, userTier),
      this.productProvider.getContext(),
      // Retrieval is keyed on the user's message, so it only runs for a real question.
      userQuestion
        ? this.ragProvider.getContext(organizationId, userId, userQuestion, activeDeviceIds)
        : Promise.resolve(''),
    ]);

    const sections = [SYSTEM_PREAMBLE, network, '', realtime, '', account, '', product];
    // Append the RAG section only when it has content, so an empty result leaves the prompt
    // byte-identical to before this seam (no trailing blank lines).
    if (rag) sections.push('', rag);
    return sections.join('\n');
  }

  estimateTokenCount(text: string): number {
    return estimateTokenCount(text);
  }
}
