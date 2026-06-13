import { Injectable, Logger } from '@nestjs/common';
import { MetricsDto } from '@nodescope/shared';
import { DataSourceStatus, MetricRecord, RawMetricPayload } from './data-sources.interface';
import { DataSourcesRepository } from './data-sources.repository';

const CONNECTED_THRESHOLD_MS = 90_000; // 3× the 30s interval

// Bounds for browser-collector metric values. WebSocket payloads bypass the
// global ValidationPipe, so the per-field caps the HTTP DTOs would apply are
// enforced here instead. Generous enough for any real bandwidth/latency reading
// while rejecting absurd attacker-controlled values (e.g. 1e308, a 10 MB tag).
const MAX_METRIC_NUMBER = 1e9;
const MAX_METRIC_STRING_LENGTH = 256;

function isBoundedMetricNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_METRIC_NUMBER;
}

function isBoundedMetricString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_METRIC_STRING_LENGTH;
}

@Injectable()
export class DataSourcesService {
  private readonly logger = new Logger(DataSourcesService.name);

  constructor(private readonly repository: DataSourcesRepository) {}

  async ingest(organizationId: string, userId: string, raw: unknown): Promise<void> {
    const payload = this.parseRawPayload(raw);
    await this.repository.createMetric({
      organizationId,
      userId,
      sourceType: 'browser',
      bandwidthDown: payload.bandwidthDown ?? null,
      bandwidthUp: payload.bandwidthUp ?? null,
      latency: payload.latency ?? null,
      connectionQuality: payload.connectionQuality ?? null,
      deviceId: payload.deviceId ?? null,
      tag: payload.tag ?? null,
    });
    this.logger.debug({ organizationId, userId }, 'Metric ingested from browser collector');
  }

  async getLatestMetric(organizationId: string, userId: string): Promise<MetricRecord | null> {
    const row = await this.repository.findLatestForUser(organizationId, userId);
    if (!row) return null;
    return this.rowToMetricRecord(row);
  }

  async getLatestMetrics(
    organizationId: string,
    userIds: string[],
  ): Promise<Map<string, MetricsDto>> {
    if (userIds.length === 0) return new Map();

    const rows = await this.repository.findLatestForUsers(organizationId, userIds);
    const result = new Map<string, MetricsDto>();
    for (const row of rows) {
      result.set(row.userId, {
        bandwidthDown: row.bandwidthDown ?? null,
        bandwidthUp: row.bandwidthUp ?? null,
        latency: row.latency ?? null,
        connectionQuality: row.connectionQuality ?? null,
        timestamp: (row.time as Date).toISOString(),
      });
    }
    return result;
  }

  async getDataSourceStatus(
    organizationId: string,
    userId: string,
  ): Promise<DataSourceStatus[]> {
    const latest = await this.repository.findLatestForUser(organizationId, userId);
    const now = Date.now();
    const lastSeenDate = latest?.time as Date | undefined;
    const connected =
      lastSeenDate !== undefined &&
      now - lastSeenDate.getTime() < CONNECTED_THRESHOLD_MS;

    return [
      {
        type: 'browser',
        connected,
        lastSeen: lastSeenDate?.toISOString() ?? null,
        message: connected
          ? 'Browser monitoring active'
          : 'Browser monitoring inactive — open NodeScope to collect data',
      },
    ];
  }

  private parseRawPayload(raw: unknown): RawMetricPayload {
    if (typeof raw !== 'object' || raw === null) return {};
    const r = raw as Record<string, unknown>;
    const result: RawMetricPayload = {};
    if (isBoundedMetricNumber(r.bandwidthDown)) result.bandwidthDown = r.bandwidthDown;
    if (isBoundedMetricNumber(r.bandwidthUp)) result.bandwidthUp = r.bandwidthUp;
    if (isBoundedMetricNumber(r.latency)) result.latency = r.latency;
    if (isBoundedMetricString(r.connectionQuality)) result.connectionQuality = r.connectionQuality;
    if (isBoundedMetricString(r.deviceId)) result.deviceId = r.deviceId;
    if (isBoundedMetricString(r.tag)) result.tag = r.tag;
    return result;
  }

  private rowToMetricRecord(row: {
    sourceType: string;
    bandwidthDown: number | null;
    bandwidthUp: number | null;
    latency: number | null;
    connectionQuality: string | null;
    time: Date;
  }): MetricRecord {
    return {
      sourceType: row.sourceType,
      bandwidthDown: row.bandwidthDown,
      bandwidthUp: row.bandwidthUp,
      latency: row.latency,
      connectionQuality: row.connectionQuality,
      timestamp: row.time.toISOString(),
    };
  }
}
