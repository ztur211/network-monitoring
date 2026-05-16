import { Injectable, Logger } from '@nestjs/common';
import { MetricsDto } from '@nodescope/shared';
import { DataSourceStatus, MetricRecord, RawMetricPayload } from './data-sources.interface';
import { DataSourcesRepository } from './data-sources.repository';

const CONNECTED_THRESHOLD_MS = 90_000; // 3× the 30s interval

@Injectable()
export class DataSourcesService {
  private readonly logger = new Logger(DataSourcesService.name);

  constructor(private readonly repository: DataSourcesRepository) {}

  async ingest(userId: string, raw: unknown): Promise<void> {
    const payload = this.parseRawPayload(raw);
    await this.repository.createMetric({
      userId,
      sourceType: 'browser',
      bandwidthDown: payload.bandwidthDown ?? null,
      bandwidthUp: payload.bandwidthUp ?? null,
      latency: payload.latency ?? null,
      connectionQuality: payload.connectionQuality ?? null,
    });
    this.logger.debug({ userId }, 'Metric ingested from browser collector');
  }

  async getLatestMetric(userId: string): Promise<MetricRecord | null> {
    const row = await this.repository.findLatestForUser(userId);
    if (!row) return null;
    return this.rowToMetricRecord(row);
  }

  async getLatestMetrics(userIds: string[]): Promise<Map<string, MetricsDto>> {
    if (userIds.length === 0) return new Map();

    const rows = await this.repository.findLatestForUsers(userIds);
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

  async getDataSourceStatus(userId: string): Promise<DataSourceStatus[]> {
    const latest = await this.repository.findLatestForUser(userId);
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

  getStatus(): DataSourceStatus[] {
    return [
      {
        type: 'browser',
        connected: false,
        lastSeen: null,
        message: 'Browser monitoring inactive',
      },
    ];
  }

  private parseRawPayload(raw: unknown): RawMetricPayload {
    if (typeof raw !== 'object' || raw === null) return {};
    const r = raw as Record<string, unknown>;
    const result: RawMetricPayload = {};
    if (typeof r.bandwidthDown === 'number') result.bandwidthDown = r.bandwidthDown;
    if (typeof r.bandwidthUp === 'number') result.bandwidthUp = r.bandwidthUp;
    if (typeof r.latency === 'number') result.latency = r.latency;
    if (typeof r.connectionQuality === 'string') result.connectionQuality = r.connectionQuality;
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
