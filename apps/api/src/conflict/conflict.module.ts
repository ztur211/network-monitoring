import { Module } from '@nestjs/common';
import { ConflictResolutionService } from './conflict.service';
import { RedisModule } from '../redis/redis.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RedisModule, RealtimeModule],
  providers: [ConflictResolutionService],
  exports: [ConflictResolutionService],
})
export class ConflictResolutionModule {}
