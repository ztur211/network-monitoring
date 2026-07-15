import { HttpStatus, Injectable } from '@nestjs/common';
import { DeviceStatus } from '@prisma/client';
import { DeviceStatusDto } from '@nodescope/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { DevicesService } from '../../devices/devices.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import { MonitoringRepository, bucketSeconds } from '../monitoring.repository';
import type { OrgMemberContext } from '../../organizations/org-context.types';
import {
  DeviceMetricsQueryDto,
  DEFAULT_METRIC_BUCKET,
  DEFAULT_METRIC_WINDOW_MS,
  MAX_METRIC_BUCKETS,
} from './monitoring.dto';

const toDto = (deviceId: string, s: DeviceStatus | undefined): DeviceStatusDto => ({
  deviceId,
  state: s?.state ?? 'UNKNOWN',
  latencyMs: s?.latencyMs ?? null,
  lastCheckAt: s?.lastCheckAt?.toISOString() ?? null,
  lastOkAt: s?.lastOkAt?.toISOString() ?? null,
  lastChangeAt: s?.lastChangeAt?.toISOString() ?? null,
});

@Injectable()
export class MonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly repo: MonitoringRepository,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Status for every in-scope device under a building (Spec 4's initial load). Reuses
   * Spec 4's subtree ∩ F3-scope device set; a device with no DeviceStatus row → UNKNOWN.
   */
  async getBuildingDeviceStatus(
    member: OrgMemberContext,
    buildingPropertyId: string,
  ): Promise<DeviceStatusDto[]> {
    const devices = await this.devices.listDevicesForBuilding(member, buildingPropertyId);
    if (devices.length === 0) return [];
    const statuses = await this.repo.listStatus(
      member.organizationId,
      devices.map((d) => d.id),
    );
    const byId = new Map(statuses.map((s) => [s.deviceId, s]));
    return devices.map((d) => toDto(d.id, byId.get(d.id)));
  }

  /** F3-scoped metric series for a single device. Out-of-scope/unknown → 404 (invisible). */
  async getDeviceMetrics(
    member: OrgMemberContext,
    deviceId: string,
    query: DeviceMetricsQueryDto,
  ): Promise<{ bucket: string; avg: number }[]> {
    const { from, to, bucket } = this.resolveMetricWindow(query);
    await this.assertDeviceVisible(member, deviceId);
    const rows = await this.repo.queryMetric(member.organizationId, deviceId, query.metric, from, to, bucket);
    return rows.map((r) => ({ bucket: new Date(r.bucket).toISOString(), avg: Number(r.avg) }));
  }

  /**
   * Turn the validated query into a concrete, BOUNDED window. The DTO already guarantees the
   * bucket is allow-listed and the dates are ISO; this applies the defaults and the two range
   * rules the DTO cannot express on its own:
   *   - from < to (an inverted or empty range is a client error, not an empty chart);
   *   - (to - from) / bucket <= MAX_METRIC_BUCKETS, which is the real memory bound. The old
   *     endpoint had neither, so `from=1970&to=2100&bucket=1 second` asked Postgres for ~10^9
   *     rows and materialized them into API memory - a single-GET OOM.
   * Both raise a 400 (NodeScopeException with BAD_REQUEST), never a 500.
   */
  private resolveMetricWindow(query: DeviceMetricsQueryDto): { from: Date; to: Date; bucket: string } {
    const bucket = query.bucket ?? DEFAULT_METRIC_BUCKET;
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - DEFAULT_METRIC_WINDOW_MS);

    if (from.getTime() >= to.getTime()) {
      throw new NodeScopeException('MON_001', 'INVALID_TIME_RANGE', HttpStatus.BAD_REQUEST);
    }

    // bucketSeconds is > 0 for every allow-listed value; guard anyway so a future allow-list typo
    // fails loudly here rather than dividing by zero.
    const bs = bucketSeconds(bucket);
    const buckets = bs > 0 ? (to.getTime() - from.getTime()) / 1000 / bs : Infinity;
    if (buckets > MAX_METRIC_BUCKETS) {
      throw new NodeScopeException('MON_002', 'METRIC_RANGE_TOO_LARGE', HttpStatus.BAD_REQUEST);
    }

    return { from, to, bucket };
  }

  /** F3-scoped distinct metric names for a device (last 24h). Out-of-scope → 404. */
  async getDeviceMetricNames(member: OrgMemberContext, deviceId: string): Promise<string[]> {
    await this.assertDeviceVisible(member, deviceId);
    return this.repo.metricNames(member.organizationId, deviceId, new Date(Date.now() - 24 * 3600_000));
  }

  /** F3-scoped recent status transitions for a device (newest-first, capped). Out-of-scope → 404. */
  async getDeviceStatusEvents(member: OrgMemberContext, deviceId: string, limit: number) {
    await this.assertDeviceVisible(member, deviceId);
    const capped = Math.min(Math.max(1, limit || 50), 200);
    const rows = await this.repo.recentStatusEvents(member.organizationId, deviceId, capped);
    return rows.map((r) => ({ time: r.time.toISOString(), state: r.state, source: r.source }));
  }

  private async assertDeviceVisible(member: OrgMemberContext, deviceId: string): Promise<void> {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, organizationId: member.organizationId },
      select: { propertyId: true },
    });
    // invisible-not-forbidden: a device the caller can't see (wrong org OR out of F3 scope) is 404
    const notFound = () =>
      new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (!device) throw notFound();
    if (
      member.role !== 'OWNER' &&
      !(await this.permissions.inScope(member.organizationId, member.id, device.propertyId))
    ) {
      throw notFound();
    }
  }
}
