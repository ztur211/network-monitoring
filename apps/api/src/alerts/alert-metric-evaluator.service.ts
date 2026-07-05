import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AlertRule, Prisma } from '@prisma/client';
import { AlertRepository } from './alert.repository';
import { AlertDedupService } from './alert-dedup.service';
import { RedisService } from '../redis/redis.service';
import type { RuleScope } from './alerts.types';

export interface MetricReader {
  /** Max latency per device over the last `sinceSeconds`, for the given devices (null = all in org). */
  maxLatencyOverWindow(orgId: string, deviceIds: string[] | null, sinceSeconds: number): Promise<Array<{ deviceId: string; value: number | null }>>;
}
export const METRIC_READER = Symbol('METRIC_READER');

export function breaches(op: string, value: number | null, threshold: number): boolean {
  if (value == null) return false;
  return op === 'lt' ? value < threshold : value > threshold; // default 'gt'
}

const LOCK = 'nodescope:lock:alert_eval';

@Injectable()
export class AlertMetricEvaluatorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertMetricEvaluatorService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly repo: AlertRepository,
    private readonly dedup: AlertDedupService,
    private readonly reader: MetricReader,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    const ms = Number(process.env.ALERT_EVAL_INTERVAL_SECONDS ?? 60) * 1000;
    this.timer = setInterval(() => void this.cycle(), ms);
    if (this.timer.unref) this.timer.unref();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async cycle(): Promise<void> {
    try {
      const ttl = Number(process.env.ALERT_EVAL_INTERVAL_SECONDS ?? 60);
      const ok = await this.redis.set(LOCK, '1', 'EX', ttl, 'NX');
      if (!ok) return;
      await this.evaluateOnce(new Date());
    } catch (err) {
      this.logger.error({ err }, 'metric eval cycle failed');
    }
  }

  async evaluateOnce(now: Date): Promise<void> {
    const rules = await this.repo.allEnabledRules('METRIC_THRESHOLD');
    for (const rule of rules) {
      if (rule.metric !== 'latencyMs' || rule.threshold == null) continue;
      const scope = rule.scope as unknown as RuleScope;
      const deviceIds = 'deviceIds' in scope ? scope.deviceIds : null; // null = all-in-org (site/network scoping resolved by the reader/all)
      const rows = await this.reader.maxLatencyOverWindow(rule.organizationId, deviceIds, rule.forSeconds ?? 60);
      for (const row of rows) {
        const over = breaches(rule.op ?? 'gt', row.value, rule.threshold);
        if (over) {
          if (await this.dedup.shouldFire(rule.organizationId, rule, row.deviceId, now)) await this.emit(rule, row.deviceId, 'FIRING', row.value, now);
        } else if (rule.notifyOnRecovery) {
          if (await this.dedup.shouldResolve(rule.organizationId, rule, row.deviceId)) await this.emit(rule, row.deviceId, 'RESOLVED', row.value, now);
        }
      }
    }
  }

  private async emit(rule: AlertRule, deviceId: string, kind: 'FIRING' | 'RESOLVED', value: number | null, now: Date): Promise<void> {
    const event = await this.repo.createEvent({
      organizationId: rule.organizationId, ruleId: rule.id, deviceId, kind, severity: rule.severity,
      detail: { metric: rule.metric, op: rule.op, threshold: rule.threshold, value, ruleName: rule.name } as Prisma.InputJsonValue,
      dedupKey: this.dedup.dedupKey(rule.id, deviceId),
    });
    await this.repo.enqueueDeliveries(event.id, rule.channelIds, now);
  }
}
