import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { DataSourcesModule } from '../data-sources/data-sources.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { AI_PROVIDER_TOKEN } from './adapters/ai-provider.interface';
import { ClaudeAdapter } from './adapters/claude.adapter';
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
    {
      provide: AI_PROVIDER_TOKEN,
      useFactory: () => {
        const provider = process.env.AI_PROVIDER ?? 'claude';
        return provider === 'openai-compatible'
          ? new OpenAICompatibleAdapter()
          : new ClaudeAdapter();
      },
    },
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
