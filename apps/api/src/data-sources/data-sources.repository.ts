import { Injectable } from '@nestjs/common';
import { DeviceMetric, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { envInt } from '../config/env';

/**
 * How far back the live-metrics push will look for a user's newest reading. Generous by default:
 * the point is chunk exclusion on a 30-day hypertable, not a tight product rule.
 */
const liveMetricsMaxAgeHours = (): number => envInt('LIVE_METRICS_MAX_AGE_HOURS', 24, { min: 1 });

interface CreateMetricData {
  organizationId: string;
  userId: string;
  sourceType: string;
  bandwidthDown?: number | null;
  bandwidthUp?: number | null;
  latency?: number | null;
  connectionQuality?: string | null;
  deviceId?: string | null;
  tag?: string | null;
}

@Injectable()
export class DataSourcesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMetric(data: CreateMetricData): Promise<void> {
    await this.prisma.deviceMetric.create({ data });
  }

  async findLatestForOrg(organizationId: string): Promise<DeviceMetric | null> {
    return this.prisma.deviceMetric.findFirst({
      where: { organizationId },
      orderBy: { time: 'desc' },
    });
  }

  async findLatestForUser(organizationId: string, userId: string): Promise<DeviceMetric | null> {
    return this.prisma.deviceMetric.findFirst({
      where: { organizationId, userId },
      orderBy: { time: 'desc' },
    });
  }

  async findLatestForUsers(organizationId: string, userIds: string[]): Promise<DeviceMetric[]> {
    if (userIds.length === 0) return [];

    // DISTINCT ON keeps the most recent row per userId in one pass (TimescaleDB-friendly).
    // Column list must stay in sync with the DeviceMetric model - deviceId/tag (Phase 13)
    // are selected so the returned rows are faithful DeviceMetric objects, not partials.
    // Scoped to organizationId so cross-org data never leaks.
    //
    // The time predicate is load-bearing, not a filter for the caller's benefit. DeviceMetric is
    // a hypertable retaining 30 days; without a lower bound on `time`, this query had to consider
    // EVERY chunk in that retention to find one row per user - once per org, every
    // REFRESH_INTERVAL_SECONDS. The bound lets TimescaleDB exclude all but the newest chunks.
    // It is also honest: this feeds a LIVE metrics push, and a reading hours old is not live.
    // Anything older is simply not pushed (the client keeps showing its last value), so the only
    // behaviour that changes is that we stop re-pushing stale readings forever.
    const idList = Prisma.join(userIds.map((id) => Prisma.sql`${id}`));
    return this.prisma.$queryRaw<DeviceMetric[]>`
      SELECT DISTINCT ON ("userId")
        id, "organizationId", "userId", "deviceId", "sourceType", "tag", "bandwidthDown", "bandwidthUp",
        latency, "connectionQuality", time
      FROM "DeviceMetric"
      WHERE "organizationId" = ${organizationId}
        AND "userId" IN (${idList})
        AND time > now() - make_interval(hours => ${liveMetricsMaxAgeHours()})
      ORDER BY "userId", time DESC
    `;
  }
}
