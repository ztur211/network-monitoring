export interface MetricRecord {
  sourceType: string;
  bandwidthDown: number | null;
  bandwidthUp: number | null;
  latency: number | null;
  connectionQuality: string | null;
  timestamp: string;
}

export interface DataSourceStatus {
  type: string;
  connected: boolean;
  lastSeen: string | null;
  message: string;
}

export interface RawMetricPayload {
  bandwidthDown?: number;
  bandwidthUp?: number;
  latency?: number;
  connectionQuality?: string;
}

export interface DataSourceCollector {
  readonly type: string;
  isAvailable(userId: string): Promise<boolean>;
  ingest(userId: string, raw: RawMetricPayload): Promise<void>;
  getLatest(userId: string): Promise<MetricRecord | null>;
  getStatus(userId: string): Promise<DataSourceStatus>;
}
