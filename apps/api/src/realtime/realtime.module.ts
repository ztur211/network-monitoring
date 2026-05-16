import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { DataSourcesModule } from '../data-sources/data-sources.module';
import { AiModule } from '../ai/ai.module';
import { RealtimeGateway } from './realtime.gateway';
import { REALTIME_SERVICE } from './realtime.types';

@Module({
  imports: [RedisModule, DataSourcesModule, AiModule],
  providers: [
    RealtimeGateway,
    { provide: REALTIME_SERVICE, useExisting: RealtimeGateway },
  ],
  exports: [REALTIME_SERVICE, RealtimeGateway],
})
export class RealtimeModule {}
