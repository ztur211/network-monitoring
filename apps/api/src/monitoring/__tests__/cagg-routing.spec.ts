import { MonitoringRepository, isCaggEligible, bucketSeconds } from '../monitoring.repository';

/**
 * Unit coverage for the continuous-aggregate routing decision. The aggregation correctness
 * itself runs against TimescaleDB in the integration suite; here we pin the pure eligibility
 * rule and that queryMetric routes to the rollup table only when the window is grid-aligned.
 */
describe('isCaggEligible', () => {
  const GRID = 300_000; // 5 min in ms
  const aligned = (mins: number) => new Date(mins * 60_000); // epoch + N min → on the 5-min grid

  it('is true for a grid-aligned window with a 5-min-multiple bucket', () => {
    expect(isCaggEligible(aligned(0), aligned(60), '1 hour')).toBe(true);
    expect(isCaggEligible(aligned(5), aligned(65), '5 minutes')).toBe(true);
    expect(isCaggEligible(aligned(0), aligned(1440), '1 day')).toBe(true);
  });

  it('is false when the bucket is below the aggregate granularity', () => {
    expect(isCaggEligible(aligned(0), aligned(60), '1 minute')).toBe(false);
    expect(isCaggEligible(aligned(0), aligned(60), '30 seconds')).toBe(false);
  });

  it('is false when the bucket is not a whole multiple of 5 minutes', () => {
    expect(bucketSeconds('7 minutes')).toBe(420);
    expect(isCaggEligible(aligned(0), aligned(60), '7 minutes')).toBe(false);
  });

  it('is false when from or to is off the 5-min grid', () => {
    const offGrid = new Date(2 * 60_000); // 2 min past epoch — not a multiple of 300_000
    expect(offGrid.getTime() % GRID).not.toBe(0);
    expect(isCaggEligible(offGrid, aligned(60), '1 hour')).toBe(false);
    expect(isCaggEligible(aligned(0), new Date(63 * 60_000), '1 hour')).toBe(false);
  });
});

describe('MonitoringRepository.queryMetric routing', () => {
  function makeRepo() {
    const calls: string[] = [];
    const prisma = {
      $queryRaw: (strings: TemplateStringsArray) => {
        calls.push(strings.join(' '));
        return Promise.resolve([]);
      },
    };
    return { repo: new MonitoringRepository(prisma as never), calls };
  }

  const a = (mins: number) => new Date(mins * 60_000);

  it('serves a grid-aligned window from the 5-min continuous aggregate', async () => {
    const { repo, calls } = makeRepo();
    await repo.queryMetric('org', 'dev', 'latency', a(0), a(60), '1 hour');
    expect(calls[0]).toContain('MonitoringMetric_5m');
    expect(calls[0]).toContain('"bucket"'); // cagg filters on bucket-start
  });

  it('serves an unaligned window from the raw hypertable', async () => {
    const { repo, calls } = makeRepo();
    await repo.queryMetric('org', 'dev', 'latency', new Date(2 * 60_000), a(60), '1 hour');
    expect(calls[0]).toContain('"MonitoringMetric"');
    expect(calls[0]).not.toContain('MonitoringMetric_5m');
    expect(calls[0]).toContain('"time"'); // raw filters on sample time
  });

  it('serves a sub-5-min bucket from raw even when grid-aligned', async () => {
    const { repo, calls } = makeRepo();
    await repo.queryMetric('org', 'dev', 'latency', a(0), a(60), '1 minute');
    expect(calls[0]).not.toContain('MonitoringMetric_5m');
  });
});
