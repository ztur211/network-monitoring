import { Inject, Injectable } from '@nestjs/common';
import {
  NETWORK_CONTEXT_PROVIDER,
  REALTIME_CONTEXT_PROVIDER,
  ACCOUNT_CONTEXT_PROVIDER,
  PRODUCT_CONTEXT_PROVIDER,
} from './context-provider.interface';
import { NetworkContextProvider } from './network-context.provider';
import { RealtimeContextProvider } from './realtime-context.provider';
import { AccountContextProvider } from './account-context.provider';
import { ProductContextProvider } from './product-context.provider';

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
  ) {}

  async buildSystemPrompt(
    organizationId: string,
    userId: string,
    userTier: string,
  ): Promise<string> {
    const [network, realtime, account, product] = await Promise.all([
      this.networkProvider.getContext(organizationId),
      this.realtimeProvider.getContext(organizationId, userId),
      this.accountProvider.getContext(userId, userTier),
      this.productProvider.getContext(),
    ]);

    return [SYSTEM_PREAMBLE, network, '', realtime, '', account, '', product].join('\n');
  }

  estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
