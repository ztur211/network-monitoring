import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const API_VERSION = (JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf-8')) as { version: string }).version;

@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check() {
    const [dbOk, redisOk] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    const status = dbOk && redisOk ? 'ok' : 'degraded';

    return {
      status,
      version: API_VERSION,
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk ? 'ok' : 'degraded',
        redis: redisOk ? 'ok' : 'degraded',
        ai: 'ok',
      },
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }
}
