import { Injectable } from '@nestjs/common';
import {
  AlertChannel,
  AlertChannelType,
  AlertDeliveryStatus,
  AlertEventKind,
  AlertRule,
  AlertSeverity,
  AlertTrigger,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import type { RuleScope } from './alerts.types';

type ChannelView = Omit<AlertChannel, 'secretEnc'>;
const redactChannel = (c: AlertChannel): ChannelView => {
  const { secretEnc: _omit, ...rest } = c;
  return rest;
};

@Injectable()
export class AlertRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // ── channels ──
  async createChannel(
    orgId: string,
    dto: {
      type: AlertChannelType;
      name: string;
      enabled?: boolean;
      config?: Prisma.JsonValue;
      secret?: string | null;
    },
  ): Promise<ChannelView> {
    const c = await this.prisma.alertChannel.create({
      data: {
        organizationId: orgId,
        type: dto.type,
        name: dto.name,
        enabled: dto.enabled ?? true,
        config: (dto.config ?? {}) as Prisma.InputJsonValue,
        secretEnc: dto.secret ? this.crypto.encrypt(dto.secret) : null,
      },
    });
    return redactChannel(c);
  }
  async listChannels(orgId: string): Promise<ChannelView[]> {
    return (
      await this.prisma.alertChannel.findMany({
        where: { organizationId: orgId },
        orderBy: { name: 'asc' },
      })
    ).map(redactChannel);
  }
  async getChannel(orgId: string, id: string): Promise<ChannelView | null> {
    const c = await this.prisma.alertChannel.findFirst({ where: { id, organizationId: orgId } });
    return c ? redactChannel(c) : null;
  }
  async deleteChannel(orgId: string, id: string): Promise<void> {
    await this.prisma.alertChannel.deleteMany({ where: { id, organizationId: orgId } });
  }
  /** Full rows (WITH secretEnc) — for the delivery path only. */
  async channelsByIds(ids: string[]): Promise<AlertChannel[]> {
    if (!ids.length) return [];
    return this.prisma.alertChannel.findMany({ where: { id: { in: ids } } });
  }

  // ── rules ──
  async createRule(
    orgId: string,
    dto: {
      name: string;
      trigger: AlertTrigger;
      scope: RuleScope;
      enabled?: boolean;
      targetStates?: string[];
      metric?: string | null;
      op?: string | null;
      threshold?: number | null;
      forSeconds?: number | null;
      severity: AlertSeverity;
      channelIds: string[];
      cooldownSeconds: number;
      notifyOnRecovery: boolean;
    },
  ): Promise<AlertRule> {
    return this.prisma.alertRule.create({
      data: {
        organizationId: orgId,
        name: dto.name,
        trigger: dto.trigger,
        scope: dto.scope as unknown as Prisma.InputJsonValue,
        enabled: dto.enabled ?? true,
        targetStates: dto.targetStates ?? [],
        metric: dto.metric ?? null,
        op: dto.op ?? null,
        threshold: dto.threshold ?? null,
        forSeconds: dto.forSeconds ?? null,
        severity: dto.severity,
        channelIds: dto.channelIds,
        cooldownSeconds: dto.cooldownSeconds,
        notifyOnRecovery: dto.notifyOnRecovery,
      },
    });
  }
  listRules(orgId: string): Promise<AlertRule[]> {
    return this.prisma.alertRule.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' } });
  }
  getRule(orgId: string, id: string): Promise<AlertRule | null> {
    return this.prisma.alertRule.findFirst({ where: { id, organizationId: orgId } });
  }
  async deleteRule(orgId: string, id: string): Promise<void> {
    await this.prisma.alertRule.deleteMany({ where: { id, organizationId: orgId } });
  }
  updateRule(
    orgId: string,
    id: string,
    patch: Partial<{ enabled: boolean; name: string }>,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.alertRule.updateMany({ where: { id, organizationId: orgId }, data: patch });
  }
  enabledRules(orgId: string, trigger: AlertTrigger): Promise<AlertRule[]> {
    return this.prisma.alertRule.findMany({ where: { organizationId: orgId, enabled: true, trigger } });
  }
  allEnabledRules(trigger: AlertTrigger): Promise<AlertRule[]> {
    return this.prisma.alertRule.findMany({ where: { enabled: true, trigger } });
  }
  /** The device's networkId (for networkIds-scoped rules); null if the device is absent. */
  async deviceNetworkId(orgId: string, deviceId: string): Promise<string | null> {
    const d = await this.prisma.device.findFirst({
      where: { id: deviceId, organizationId: orgId }, select: { networkId: true },
    });
    return d?.networkId ?? null;
  }

  // ── events + deliveries ──
  createEvent(e: {
    organizationId: string;
    ruleId: string;
    deviceId: string | null;
    kind: AlertEventKind;
    severity: AlertSeverity;
    detail: Prisma.InputJsonValue;
    dedupKey: string;
  }) {
    return this.prisma.alertEvent.create({ data: e });
  }
  latestEventFor(orgId: string, ruleId: string, deviceId: string | null) {
    return this.prisma.alertEvent.findFirst({
      where: { organizationId: orgId, ruleId, deviceId },
      orderBy: { createdAt: 'desc' },
    });
  }
  listEvents(orgId: string, limit = 100) {
    return this.prisma.alertEvent.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
  async enqueueDeliveries(eventId: string, channelIds: string[], now: Date): Promise<void> {
    if (!channelIds.length) return;
    await this.prisma.alertDelivery.createMany({
      data: channelIds.map((channelId) => ({ alertEventId: eventId, channelId, nextAttemptAt: now })),
    });
  }
  dueDeliveries(now: Date, limit = 50) {
    return this.prisma.alertDelivery.findMany({
      where: { status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      include: { event: true },
    });
  }
  async markDelivery(
    id: string,
    patch: {
      status: AlertDeliveryStatus;
      attempts?: number;
      nextAttemptAt?: Date;
      lastError?: string | null;
      lastAttemptAt?: Date;
    },
  ): Promise<void> {
    await this.prisma.alertDelivery.update({ where: { id }, data: patch });
  }
}
