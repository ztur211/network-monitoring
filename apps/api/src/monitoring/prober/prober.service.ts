import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IngestService } from '../ingest/ingest.service';
import { probeDevice, ProbeResult } from '@nodescope/probe';

const cfg = () => ({
  enabled: process.env.MONITORING_PROBER_ENABLED === 'true',
  intervalMs: Number(process.env.MONITORING_PROBE_INTERVAL_MS ?? 30000),
  concurrency: Number(process.env.MONITORING_PROBE_CONCURRENCY ?? 20),
  icmpEnabled: process.env.MONITORING_ICMP_ENABLED !== 'false',
  ports: (process.env.MONITORING_PROBE_PORTS ?? '443,80,22').split(',').map((p) => Number(p.trim())),
  timeoutMs: Number(process.env.MONITORING_PROBE_TIMEOUT_MS ?? 2000),
});

/** Run an async fn over items with a bounded concurrency (a worker pool draining a queue). */
export async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const n = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}

export async function runProbeCycle(
  devices: { id: string; organizationId: string; ipAddress: string }[],
  probe: (ip: string) => Promise<ProbeResult>,
  ingest: Pick<IngestService, 'reportStatusCheck'>,
  concurrency: number,
): Promise<void> {
  await mapLimit(devices, concurrency, async (d) => {
    const r = await probe(d.ipAddress);
    await ingest.reportStatusCheck({
      organizationId: d.organizationId,
      deviceId: d.id,
      ok: r.ok,
      latencyMs: r.latencyMs,
      source: 'prober',
    });
  });
}

/**
 * The embedded collector for on-network / self-host deploys. OFF by default
 * (MONITORING_PROBER_ENABLED) — managed cloud cannot reach a customer LAN and uses
 * the Agent instead. setInterval (not @nestjs/schedule) keeps the dep surface small.
 */
@Injectable()
export class ProberService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProberService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: IngestService,
  ) {}

  onModuleInit(): void {
    const c = cfg();
    if (!c.enabled) return; // OFF by default — cloud uses the Agent
    this.logger.log(`Embedded prober enabled (interval ${c.intervalMs}ms, concurrency ${c.concurrency})`);
    this.timer = setInterval(() => {
      void this.cycle().catch((e) => this.logger.warn({ e }, 'probe cycle failed'));
    }, c.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async cycle(): Promise<void> {
    const c = cfg();
    const devices = await this.prisma.device.findMany({
      where: { ipAddress: { not: null } },
      select: { id: true, organizationId: true, ipAddress: true },
    });
    await runProbeCycle(
      devices as { id: string; organizationId: string; ipAddress: string }[],
      (ip) => probeDevice(ip, { icmpEnabled: c.icmpEnabled, ports: c.ports, timeoutMs: c.timeoutMs }),
      this.ingest,
      c.concurrency,
    );
  }
}
