import { Injectable } from '@nestjs/common';
import { DeviceStatus, DeviceStatusState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * DeviceStatus current-state rows are Prisma-managed; MonitoringMetric and
 * DeviceStatusEvent are raw-SQL TimescaleDB hypertables (Prisma does not model
 * them) accessed via $executeRaw / $queryRaw.
 */
@Injectable()
export class MonitoringRepository {
  constructor(private readonly prisma: PrismaService) {}

  getStatus(organizationId: string, deviceId: string): Promise<DeviceStatus | null> {
    return this.prisma.deviceStatus.findFirst({ where: { organizationId, deviceId } });
  }

  listStatus(organizationId: string, deviceIds: string[]): Promise<DeviceStatus[]> {
    return this.prisma.deviceStatus.findMany({
      where: { organizationId, deviceId: { in: deviceIds } },
    });
  }

  async upsertStatus(d: {
    organizationId: string;
    deviceId: string;
    state: DeviceStatusState;
    latencyMs: number | null;
    consecutiveFails: number;
    source: string;
    ok: boolean;
    changed?: boolean;
  }): Promise<void> {
    const now = new Date();
    await this.prisma.deviceStatus.upsert({
      where: { deviceId: d.deviceId },
      create: {
        organizationId: d.organizationId,
        deviceId: d.deviceId,
        state: d.state,
        latencyMs: d.latencyMs,
        consecutiveFails: d.consecutiveFails,
        source: d.source,
        lastCheckAt: now,
        lastOkAt: d.ok ? now : null,
        lastChangeAt: now,
      },
      update: {
        state: d.state,
        latencyMs: d.latencyMs,
        consecutiveFails: d.consecutiveFails,
        source: d.source,
        lastCheckAt: now,
        ...(d.ok ? { lastOkAt: now } : {}),
        ...(d.changed ? { lastChangeAt: now } : {}),
      },
    });
  }

  insertMetric(d: {
    organizationId: string;
    deviceId: string;
    metric: string;
    value: number;
    source: string;
    ts?: Date;
  }): Promise<unknown> {
    return this.prisma.$executeRaw`INSERT INTO "MonitoringMetric" ("time","organizationId","deviceId","metric","value","source")
      VALUES (${d.ts ?? new Date()}, ${d.organizationId}, ${d.deviceId}, ${d.metric}, ${d.value}, ${d.source})`;
  }

  insertStatusEvent(d: {
    organizationId: string;
    deviceId: string;
    state: DeviceStatusState;
    source: string;
  }): Promise<unknown> {
    return this.prisma.$executeRaw`INSERT INTO "DeviceStatusEvent" ("time","organizationId","deviceId","state","source")
      VALUES (${new Date()}, ${d.organizationId}, ${d.deviceId}, ${d.state}, ${d.source})`;
  }

  queryMetric(
    organizationId: string,
    deviceId: string,
    metric: string,
    from: Date,
    to: Date,
    bucket: string,
  ): Promise<{ bucket: Date; avg: number }[]> {
    return this.prisma.$queryRaw`SELECT time_bucket(${bucket}::interval, "time") AS bucket, avg("value")::float AS avg
      FROM "MonitoringMetric" WHERE "organizationId" = ${organizationId} AND "deviceId" = ${deviceId} AND "metric" = ${metric}
      AND "time" >= ${from} AND "time" <= ${to} GROUP BY bucket ORDER BY bucket`;
  }
}
