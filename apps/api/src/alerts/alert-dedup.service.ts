import { Injectable } from '@nestjs/common';
import { AlertRule } from '@prisma/client';
import { AlertRepository } from './alert.repository';

@Injectable()
export class AlertDedupService {
  constructor(private readonly repo: AlertRepository) {}

  dedupKey(ruleId: string, deviceId: string | null): string {
    return `${ruleId}:${deviceId ?? '-'}`;
  }

  async shouldFire(orgId: string, rule: AlertRule, deviceId: string | null, now: Date): Promise<boolean> {
    const latest = await this.repo.latestEventFor(orgId, rule.id, deviceId);
    if (!latest) return true;
    if (latest.kind === 'FIRING') return false; // already open
    // last event was RESOLVED — respect the cooldown window before re-firing
    const elapsedMs = now.getTime() - latest.createdAt.getTime();
    return elapsedMs >= rule.cooldownSeconds * 1000;
  }

  async shouldResolve(orgId: string, rule: AlertRule, deviceId: string | null): Promise<boolean> {
    const latest = await this.repo.latestEventFor(orgId, rule.id, deviceId);
    return latest?.kind === 'FIRING';
  }
}
