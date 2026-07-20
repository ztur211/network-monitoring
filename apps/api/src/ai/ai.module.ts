import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { DataSourcesModule } from '../data-sources/data-sources.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { AI_PROVIDER_TOKEN } from './adapters/ai-provider.interface';
import { OpenAICompatibleAdapter } from './adapters/openai-compatible.adapter';
import {
  NETWORK_CONTEXT_PROVIDER,
  REALTIME_CONTEXT_PROVIDER,
  ACCOUNT_CONTEXT_PROVIDER,
  PRODUCT_CONTEXT_PROVIDER,
  RAG_CONTEXT_PROVIDER,
} from './context/context-provider.interface';
import { NetworkContextProvider } from './context/network-context.provider';
import { NetworkContextRepository } from './context/network-context.repository';
import { RealtimeContextProvider } from './context/realtime-context.provider';
import { AccountContextProvider } from './context/account-context.provider';
import { ProductContextProvider } from './context/product-context.provider';
import { NoopRagContextProvider } from './context/noop-rag-context.provider';
import { ContextBuilderService } from './context/context-builder.service';
import { AiRateLimiterService } from './rate-limiting/ai-rate-limiter.service';
import { ConversationService } from './conversation/conversation.service';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';

@Module({
  imports: [PrismaModule, RedisModule, DataSourcesModule, PermissionsModule],
  controllers: [AiController],
  providers: [
    // One adapter, no provider selection. Ollama, llama.cpp, vLLM and LM Studio
    // all speak the OpenAI-compatible wire format, so the runtime is chosen by
    // pointing AI_BASE_URL at it. Hosted providers are deliberately unreachable:
    // the network context carries device IPs, topology and circuit IDs, which
    // must never leave the building.
    { provide: AI_PROVIDER_TOKEN, useClass: OpenAICompatibleAdapter },
    { provide: NETWORK_CONTEXT_PROVIDER, useClass: NetworkContextProvider },
    NetworkContextRepository,
    { provide: REALTIME_CONTEXT_PROVIDER, useClass: RealtimeContextProvider },
    { provide: ACCOUNT_CONTEXT_PROVIDER, useClass: AccountContextProvider },
    { provide: PRODUCT_CONTEXT_PROVIDER, useClass: ProductContextProvider },
    { provide: RAG_CONTEXT_PROVIDER, useClass: NoopRagContextProvider },
    ContextBuilderService,
    AiRateLimiterService,
    ConversationService,
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
