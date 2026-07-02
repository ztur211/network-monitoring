import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const API_VERSION = (() => {
  // __dirname exists in CJS (prod build + ts-jest CJS); in ESM (ts-jest --useESM)
  // it throws ReferenceError. Fall back to process.cwd() lookups so the same
  // controller boots in both module systems. Skip candidates whose package.json
  // lacks a version field (e.g. the repo-root monorepo package.json).
  const baseDir = (() => {
    try { return __dirname; } catch { return process.cwd(); }
  })();
  const candidates = [
    join(baseDir, '../../package.json'),       // ts-jest CJS: apps/api/src/health/
    join(baseDir, '../../../package.json'),    // compiled dist: apps/api/dist/src/health/
    join(process.cwd(), 'package.json'),        // running from apps/api/ in ESM
    join(process.cwd(), 'apps/api/package.json'), // running from repo root in ESM
  ];
  for (const path of candidates) {
    try {
      const version = (JSON.parse(readFileSync(path, 'utf-8')) as { version?: string }).version;
      if (typeof version === 'string' && version.length > 0) return version;
    } catch {/* try next */}
  }
  return '0.0.0-unknown';
})();

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
    const [dbOk, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    // A disabled (single-node) Redis is a healthy configuration, not a degradation.
    const redisHealthy = redis.status !== 'degraded';
    const status = dbOk && redisHealthy ? 'ok' : 'degraded';

    return {
      status,
      version: API_VERSION,
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk ? 'ok' : 'degraded',
        redis,
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

  private async checkRedis(): Promise<{
    enabled: boolean;
    mode: string;
    clusterMode: boolean;
    status: 'ok' | 'degraded' | 'disabled';
  }> {
    const info = this.redis.describe();
    // In-memory backing: nothing to ping — report it as an explicit, healthy 'disabled'.
    if (!this.redis.enabled) {
      return { ...info, status: 'disabled' };
    }
    try {
      await this.redis.ping();
      return { ...info, status: 'ok' };
    } catch {
      return { ...info, status: 'degraded' };
    }
  }
}
