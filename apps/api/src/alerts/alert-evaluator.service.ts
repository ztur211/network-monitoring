import { Injectable, Logger } from '@nestjs/common';
import { AlertRule, Prisma } from '@prisma/client';
import { AlertRepository } from './alert.repository';
import { AlertDedupService } from './alert-dedup.service';
import type { RuleScope } from './alerts.types';
import type { DeviceStatusEmit, MonitoringEmitter } from '../monitoring/ingest/ingest.service';

export function scopeCovers(scope: RuleScope, ctx: { deviceId: string; networkId?: string | null; siteId: string }): boolean {
  if ('all' in scope) return scope.all === true;
  if ('deviceIds' in scope) return scope.deviceIds.includes(ctx.deviceId);
  if ('networkIds' in scope) return ctx.networkId != null && scope.networkIds.includes(ctx.networkId);
  if ('siteIds' in scope) return scope.siteIds.includes(ctx.siteId);
  return false;
}

@Injectable()
export class AlertEvaluatorService implements MonitoringEmitter {
  private readonly logger = new Logger(AlertEvaluatorService.name);

  constructor(private readonly repo: AlertRepository, private readonly dedup: AlertDedupService) {}

  // MonitoringEmitter port impl — never block/throw on the ingest path.
  emitDeviceStatus(p: DeviceStatusEmit): void {
    void this.onStatusChange(p).catch((err) => this.logger.error({ err }, 'alert onStatusChange failed'));
  }

  async onStatusChange(p: DeviceStatusEmit): Promise<void> {
    const rules = await this.repo.enabledRules(p.organizationId, 'STATE_TRANSITION');
    const now = new Date(p.at);
    for (const rule of rules) {
      const scope = rule.scope as unknown as RuleScope;
      if (!scopeCovers(scope, { deviceId: p.deviceId, siteId: p.governingSiteId })) continue;

      if (rule.targetStates.includes(p.state)) {
        if (await this.dedup.shouldFire(p.organizationId, rule, p.deviceId, now)) {
          await this.emit(rule, p, 'FIRING');
        }
      } else if (p.state === 'UP' && rule.notifyOnRecovery) {
        if (await this.dedup.shouldResolve(p.organizationId, rule, p.deviceId)) {
          await this.emit(rule, p, 'RESOLVED');
        }
      }
    }
  }

  private async emit(rule: AlertRule, p: DeviceStatusEmit, kind: 'FIRING' | 'RESOLVED'): Promise<void> {
    const now = new Date(p.at);
    const event = await this.repo.createEvent({
      organizationId: p.organizationId, ruleId: rule.id, deviceId: p.deviceId, kind,
      severity: rule.severity,
      detail: { state: p.state, latencyMs: p.latencyMs, at: p.at, ruleName: rule.name } as Prisma.InputJsonValue,
      dedupKey: this.dedup.dedupKey(rule.id, p.deviceId),
    });
    await this.repo.enqueueDeliveries(event.id, rule.channelIds, now);
  }
}
