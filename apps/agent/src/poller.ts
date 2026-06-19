import type { AgentDeviceDto, StatusCheckDto, MetricSampleDto, IngestBatchDto } from '@nodescope/shared';
import { probeDevice, type ProbeResult } from '@nodescope/probe';
import type { AgentConfig } from './config.js';

export interface CollectResult { checks: StatusCheckDto[]; metrics: MetricSampleDto[] }
export interface Collector { collect(device: AgentDeviceDto): Promise<CollectResult> }

export function reachabilityCollector(probe: (ip: string) => Promise<ProbeResult>): Collector {
  return {
    async collect(d) {
      const r = await probe(d.ipAddress);
      const checks: StatusCheckDto[] = [{ deviceId: d.id, ok: r.ok, latencyMs: r.latencyMs }];
      const metrics: MetricSampleDto[] = r.latencyMs != null ? [{ deviceId: d.id, metric: 'latency_ms', value: r.latencyMs }] : [];
      return { checks, metrics };
    },
  };
}

export function probeFromConfig(cfg: AgentConfig): (ip: string) => Promise<ProbeResult> {
  return (ip) => probeDevice(ip, { icmpEnabled: cfg.icmpEnabled, ports: cfg.ports, timeoutMs: cfg.timeoutMs });
}

export async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const n = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: n }, async () => { while (queue.length) await fn(queue.shift()!); }));
}

export async function pollDevices(devices: AgentDeviceDto[], collectors: Collector[], concurrency: number): Promise<Required<IngestBatchDto>> {
  const checks: StatusCheckDto[] = []; const metrics: MetricSampleDto[] = [];
  await mapLimit(devices, concurrency, async (d) => {
    for (const c of collectors) { const r = await c.collect(d); checks.push(...r.checks); metrics.push(...r.metrics); }
  });
  return { checks, metrics };
}
