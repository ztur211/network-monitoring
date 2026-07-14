import { IngestService } from '../../ingest/ingest.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProberService, parsePorts } from '../prober.service';

describe('parsePorts', () => {
  it('parses a normal port list', () => {
    expect(parsePorts('443,80,22')).toEqual([443, 80, 22]);
  });

  it('tolerates whitespace', () => {
    expect(parsePorts(' 443 , 80 ')).toEqual([443, 80]);
  });

  it('defaults when unset or empty', () => {
    expect(parsePorts(undefined)).toEqual([443, 80, 22]);
    expect(parsePorts('')).toEqual([443, 80, 22]);
  });

  /**
   * A NaN port used to survive into the probe, so every device paid a doomed TCP connect and
   * the full timeout for it - silently making each cycle longer, which is exactly what tips a
   * cycle past its interval.
   */
  it('drops entries that are not real ports rather than probing NaN', () => {
    expect(parsePorts('443,http,,80')).toEqual([443, 80]);
    expect(parsePorts('0,70000,-1,443')).toEqual([443]);
  });
});

/**
 * The prober's failure mode under load is a *pileup*: a probe cycle whose wall-time
 * (devices x probe timeout) exceeds MONITORING_PROBE_INTERVAL_MS overlaps the next tick.
 * Each live cycle holds a full device list, `concurrency` open sockets and `concurrency`
 * spawned `ping` children, so overlapping cycles multiply the process's real resource
 * use without bound -- and because they contend, each cycle gets *slower*, which makes
 * the next overlap more likely. That is the runaway.
 *
 * These tests drive the real onModuleInit -> setInterval -> cycle path and count how many
 * cycles are in flight at once.
 */
describe('ProberService (cycle scheduling)', () => {
  const env = process.env;

  /**
   * A prisma stub whose device.findMany takes `cycleMs` to resolve -- i.e. a cycle that
   * takes longer than the tick interval. Tracks concurrent in-flight cycles.
   */
  function slowPrisma(cycleMs: number) {
    const state = { inFlight: 0, maxInFlight: 0, started: 0 };
    const prisma = {
      device: {
        findMany: jest.fn(() => {
          state.started++;
          state.inFlight++;
          state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
          return new Promise((resolve) => {
            setTimeout(() => {
              state.inFlight--;
              resolve([]); // no devices -> the cycle ends when findMany settles
            }, cycleMs);
          });
        }),
      },
    } as unknown as PrismaService;
    return { prisma, state };
  }

  const ingest = { reportStatusCheck: jest.fn() } as unknown as IngestService;

  beforeEach(() => {
    jest.useFakeTimers();
    process.env = { ...env };
    process.env.MONITORING_PROBER_ENABLED = 'true';
    process.env.MONITORING_PROBE_INTERVAL_MS = '1000';
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = env;
    jest.clearAllMocks();
  });

  /** Advance fake time in tick-sized steps, flushing microtasks so awaits settle. */
  async function advance(ms: number, step = 100) {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      jest.advanceTimersByTime(step);
      await Promise.resolve();
      await Promise.resolve();
    }
  }

  it('never runs two cycles at once when a cycle outlasts the tick interval', async () => {
    // A 5s cycle against a 1s tick: without a guard, tick N+1..N+4 all fire while the
    // first cycle is still running.
    const { prisma, state } = slowPrisma(5000);
    const service = new ProberService(prisma, ingest);

    service.onModuleInit();
    await advance(10_000);
    service.onModuleDestroy();

    expect(state.maxInFlight).toBe(1);
  });

  it('skips ticks that land on a running cycle rather than queueing them', async () => {
    const { prisma, state } = slowPrisma(5000);
    const service = new ProberService(prisma, ingest);

    service.onModuleInit();
    await advance(10_000);
    service.onModuleDestroy();

    // 10s of ticks at 1s, cycles taking 5s each: a skipping scheduler starts ~2, never 10.
    expect(state.started).toBeLessThanOrEqual(3);
  });

  it('keeps probing on the next tick after a cycle throws', async () => {
    const prisma = {
      device: { findMany: jest.fn().mockRejectedValue(new Error('db down')) },
    } as unknown as PrismaService;
    const service = new ProberService(prisma, ingest);

    service.onModuleInit();
    await advance(3000);
    service.onModuleDestroy();

    // A failed cycle must release the guard, not wedge the prober forever.
    expect((prisma.device.findMany as jest.Mock).mock.calls.length).toBeGreaterThan(1);
  });
});
