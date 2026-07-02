import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { createRedisService, redisConfigFromEnv } from './redis.provider';

@Global()
@Module({
  providers: [
    {
      provide: RedisService,
      // Real ioredis backing when REDIS_URL is set; in-memory backing (single-node)
      // when it isn't. Fails closed if CLUSTER_MODE is on without REDIS_URL.
      useFactory: () => createRedisService(redisConfigFromEnv()),
    },
  ],
  exports: [RedisService],
})
export class RedisModule {}
