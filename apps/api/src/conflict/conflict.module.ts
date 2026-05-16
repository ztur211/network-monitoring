import { Module } from '@nestjs/common';
import { ConflictResolutionService } from './conflict.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [ConflictResolutionService],
  exports: [ConflictResolutionService],
})
export class ConflictResolutionModule {}
