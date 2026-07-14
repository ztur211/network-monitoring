import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IngestService } from '../ingest/ingest.service';
import { probeDevice, ProbeResult, setIcmpUnavailableHandler } from '@nodescope/probe';
import { nonOverlapping } from '@nodescope/shared';
import { envInt } from '../../config/env';

// Every numeric knob goes through envInt: `Number('')` is 0, so an env var that is set but
// empty used to yield intervalMs=0 (a hot loop pegging a core) or concurrency=0 (a worker pool
// with no workers, which never drains its queue). A bad value must degrade to the default.
const cfg = () => ({
  enabled: process.env.MONITORING_PROBER_ENABLED === 'true',
  intervalMs: envInt('MONITORING_PROBE_INTERVAL_MS', 30000, { min: 1000 }),
  concurrency: envInt('MONITORING_PROBE_CONCURRENCY', 20, { min: 1, max: 500 }),
  icmpEnabled: process.env.MONITORING_ICMP_ENABLED !== 'false',
  ports: parsePorts(process.env.MONITORING_PROBE_PORTS),
  timeoutMs: envInt('MONITORING_PROBE_TIMEOUT_MS', 2000, { min: 100 }),
});

/**
 * A malformed port ("http", "") used to become NaN and get probed as-is, so every device paid
 * a doomed connect + the full timeout. Drop anything that is not a real port instead.
 */
export function parsePorts(raw: string | undefined): number[] {
  const source = raw === undefined || raw.trim() === '' ? '443,80,22' : raw;
  return source
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((p) => Number.isInteger(p) && p > 0 && p <= 65535);
}

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
 * (MONITORING_PROBER_ENABLED) - managed cloud cannot reach a customer LAN and uses
 * the Agent instead. setInterval (not @nestjs/schedule) keeps the dep surface small.
 */
@Injectable()
export class ProberService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProberService.name);
  private timer?: ReturnType<typeof setInterval>;
  private skippedTicks = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: IngestService,
  ) {}

  onModuleInit(): void {
    const c = cfg();
    if (!c.enabled) return; // OFF by default - cloud uses the Agent
    this.logger.log(`Embedded prober enabled (interval ${c.intervalMs}ms, concurrency ${c.concurrency})`);

    // Route the probe's "there is no ping binary here" alarm into the app logger, so a broken
    // image shows up in `docker logs` instead of being mistaken for every device being down.
    setIcmpUnavailableHandler((message) => this.logger.error(message));

    // A cycle's wall-time is devices x probe timeout / concurrency, so a large or unreachable
    // fleet can outlast intervalMs. Ticks that land on a running cycle are SKIPPED, never
    // queued: an unguarded setInterval would stack cycles, each with its own `concurrency`
    // sockets and spawned `ping` children, and the contention would make every cycle slower
    // still - an unbounded pileup that blows the container's CPU/memory budget. Skipping caps
    // steady-state cost at one cycle and degrades by probing less often instead.
    const tick = nonOverlapping(
      () => this.cycle(),
      () => {
        this.skippedTicks++;
        this.logger.warn(
          { skippedTicks: this.skippedTicks, intervalMs: c.intervalMs },
          'probe cycle still running when the next tick fired - skipping it. The fleet no longer ' +
            'fits in MONITORING_PROBE_INTERVAL_MS; raise the interval or the concurrency.',
        );
      },
    );

    this.timer = setInterval(() => {
      void tick().catch((e) => this.logger.warn({ e }, 'probe cycle failed'));
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
