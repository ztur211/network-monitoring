export type SourceType = 'browser' | 'agent' | 'router';

export interface MetricRowDto {
  userId: string;
  sourceType: SourceType;
  bandwidthDown: number | null;
  bandwidthUp: number | null;
  latency: number | null;
  connectionQuality: string | null;
  time: string;
}
