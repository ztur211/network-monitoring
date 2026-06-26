import { HttpStatus, Injectable } from '@nestjs/common';
import { AiUsageDto } from '@nodescope/shared';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import { RedisService } from '../../redis/redis.service';

const HOURLY_LIMIT = parseInt(process.env.AI_HOURLY_LIMIT ?? '20', 10);
const DAILY_LIMIT = parseInt(process.env.AI_DAILY_LIMIT ?? '100', 10);
const IP_HOURLY_LIMIT = parseInt(process.env.AI_IP_HOURLY_LIMIT ?? '50', 10);
const MONTHLY_TOKEN_BUDGET = parseInt(process.env.AI_MONTHLY_TOKEN_BUDGET ?? '100000', 10);

const WARN_THRESHOLD = 0.8;

function currentHourTag(): string {
  return new Date().toISOString().slice(0, 13);
}

function currentDayTag(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthTag(): string {
  return new Date().toISOString().slice(0, 7);
}

function nextMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

// An optional `scope` segments the counters into an independent bucket. The
// default (no scope) preserves the original chat keys. Onboarding passes
// 'onboarding' so its ~10-message wizard can never be blocked by — and never
// eats into — the user's regular chat quota.
function seg(scope?: string): string {
  return scope ? `${scope}:` : '';
}
function hourlyKey(userId: string, scope?: string): string {
  return `ai:rate:hourly:${seg(scope)}${userId}:${currentHourTag()}`;
}
function dailyKey(userId: string, scope?: string): string {
  return `ai:rate:daily:${seg(scope)}${userId}:${currentDayTag()}`;
}
function monthlyTokenKey(userId: string, scope?: string): string {
  return `ai:rate:monthly_tokens:${seg(scope)}${userId}:${currentMonthTag()}`;
}
function ipHourlyKey(ip: string, scope?: string): string {
  return `ai:rate:ip:${seg(scope)}${ip}:${currentHourTag()}`;
}

@Injectable()
export class AiRateLimiterService {
  constructor(private readonly redis: RedisService) {}

  async checkRateLimits(userId: string, ip: string, scope?: string): Promise<void> {
    const values = await this.redis.mget(
      hourlyKey(userId, scope),
      dailyKey(userId, scope),
      monthlyTokenKey(userId, scope),
      ipHourlyKey(ip, scope),
    );

    const hourly = parseInt(values[0] ?? '0', 10);
    const daily = parseInt(values[1] ?? '0', 10);
    const monthlyTokens = parseInt(values[2] ?? '0', 10);
    const ipHourly = parseInt(values[3] ?? '0', 10);

    if (hourly >= HOURLY_LIMIT) {
      throw new NodeScopeException('AI_001', 'AI_RATE_LIMIT_HOURLY', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (daily >= DAILY_LIMIT) {
      throw new NodeScopeException('AI_002', 'AI_RATE_LIMIT_DAILY', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (monthlyTokens >= MONTHLY_TOKEN_BUDGET) {
      throw new NodeScopeException('AI_003', 'AI_BUDGET_EXHAUSTED', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (ipHourly >= IP_HOURLY_LIMIT) {
      throw new NodeScopeException('GEN_004', 'RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async incrementUsage(userId: string, tokensUsed: number, ip: string, scope?: string): Promise<void> {
    const pipeline = this.redis.pipeline();

    pipeline.incr(hourlyKey(userId, scope));
    pipeline.expire(hourlyKey(userId, scope), 3600);

    pipeline.incr(dailyKey(userId, scope));
    pipeline.expire(dailyKey(userId, scope), 86400);

    pipeline.incrby(monthlyTokenKey(userId, scope), tokensUsed);
    const monthlyTtl = Math.floor((nextMonthStart().getTime() - Date.now()) / 1000) + 86400;
    pipeline.expire(monthlyTokenKey(userId, scope), monthlyTtl);

    // Per-IP hourly request counter — checkRateLimits reads ipHourlyKey and throws
    // GEN_004 past IP_HOURLY_LIMIT, but nothing wrote this key, so the per-IP abuse
    // guard (one IP hammering AI across many accounts) was dead. Increment it here,
    // mirroring the hourly user counter (1 per request, 1-hour TTL).
    pipeline.incr(ipHourlyKey(ip, scope));
    pipeline.expire(ipHourlyKey(ip, scope), 3600);

    await pipeline.exec();
  }

  async getUsageCounts(userId: string): Promise<AiUsageDto> {
    const values = await this.redis.mget(
      hourlyKey(userId),
      dailyKey(userId),
      monthlyTokenKey(userId),
    );

    const hourlyUsed = parseInt(values[0] ?? '0', 10);
    const dailyUsed = parseInt(values[1] ?? '0', 10);
    const monthlyTokensUsed = parseInt(values[2] ?? '0', 10);

    return {
      hourlyUsed,
      hourlyLimit: HOURLY_LIMIT,
      dailyUsed,
      dailyLimit: DAILY_LIMIT,
      monthlyTokensUsed,
      monthlyTokenBudget: MONTHLY_TOKEN_BUDGET,
      resetsAt: nextMonthStart().toISOString(),
    };
  }

  buildUsageWarning(counts: {
    hourlyUsed: number;
    dailyUsed: number;
    monthlyTokensUsed: number;
  }): string | null {
    if (counts.hourlyUsed >= HOURLY_LIMIT * WARN_THRESHOLD) {
      return `You've used ${counts.hourlyUsed}/${HOURLY_LIMIT} messages this hour.`;
    }
    if (counts.dailyUsed >= DAILY_LIMIT * WARN_THRESHOLD) {
      return `You've used ${counts.dailyUsed}/${DAILY_LIMIT} messages today.`;
    }
    if (counts.monthlyTokensUsed >= MONTHLY_TOKEN_BUDGET * WARN_THRESHOLD) {
      const pct = Math.floor((counts.monthlyTokensUsed / MONTHLY_TOKEN_BUDGET) * 100);
      return `You've used ${pct}% of your monthly token budget.`;
    }
    return null;
  }
}
