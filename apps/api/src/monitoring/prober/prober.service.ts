import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IngestService } from '../ingest/ingest.service';
import { probeDevice, ProbeResult, setIcmpUnavailableHandler } from '@nodescope/probe';
import { mapLimit, nonOverlapping } from '@nodescope/shared';
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

/** Devices pulled per page in a probe cycle. Bounds the cycle's peak memory, not its total work. */
const PAGE_SIZE = 500;

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

  /**
   * The single point where a cycle touches the network. Split out as a seam so the scheduling and
   * paging above can be tested without opening 1200 sockets, and so a future collector (SNMP,
   * agent-relayed) can be swapped in without touching the loop.
   */
  protected probeIp(ip: string, c: ReturnType<typeof cfg>): Promise<ProbeResult> {
    return probeDevice(ip, { icmpEnabled: c.icmpEnabled, ports: c.ports, timeoutMs: c.timeoutMs });
  }

  /**
   * Probe every device with an IP, one page at a time.
   *
   * This used to be a single unpaginated findMany across ALL orgs, so peak memory was the whole
   * fleet: 100k devices materialized ~10MB of JS objects, plus a 100k-entry work queue, every
   * single tick. Keyset pagination (order by id, cursor on the last id) keeps peak memory at one
   * page no matter how large the fleet grows, and the new @@index([ipAddress]) means each page is
   * an index range scan rather than a fresh sequential scan of Device.
   */
  async cycle(): Promise<void> {
    const c = cfg();
    let cursor: string | undefined;

    for (;;) {
      const page = await this.prisma.device.findMany({
        where: { ipAddress: { not: null } },
        select: { id: true, organizationId: true, ipAddress: true },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      });
      if (page.length === 0) return;

      await runProbeCycle(
        page as { id: string; organizationId: string; ipAddress: string }[],
        (ip) => this.probeIp(ip, c),
        this.ingest,
        c.concurrency,
      );

      if (page.length < PAGE_SIZE) return;
      cursor = page[page.length - 1].id;
    }
  }
}
