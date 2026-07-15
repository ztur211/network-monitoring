import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { IngestController } from '../ingest.controller';
import { IngestService } from '../ingest.service';
import { IngestTokenService } from '../ingest-token.service';
import { IngestTokenGuard } from '../ingest-token.guard';
import { INGEST_BODY_LIMIT, INGEST_MAX_CHECKS_PER_BATCH, INGEST_MAX_METRICS_PER_BATCH } from '../ingest.dto';
import { GlobalExceptionFilter } from '../../../common/filters/global-exception.filter';

/**
 * HTTP-level contract for POST /v1/monitoring/ingest: what the AGENT sees. No DB - the service is
 * mocked - because everything under test here (body limit, item caps, 413-vs-400) is decided by the
 * request pipeline before any persistence happens.
 *
 * The regression this pins down: the agent sends one batch containing every device, Nest passed no
 * `limit` to express.json() so body-parser's 100 kB DEFAULT applied, a fleet crossed 100 kB at
 * roughly 800 devices, the API answered 413 - and the agent's buffer treated that 4xx as permanent
 * and DROPPED the batch. Silent, permanent monitoring data loss for any fleet above ~800 devices.
 *
 * The app is wired exactly as bootstrap() wires it (same body limit, same global ValidationPipe,
 * same global exception filter) so the status codes asserted here are the ones an agent really gets.
 */
describe('ingest batch caps (HTTP contract)', () => {
  let app: INestApplication;
  const ingestBatch = jest.fn().mockResolvedValue(undefined);

  const check = (i: number) => ({ deviceId: `clh${String(i).padStart(22, '0')}`, ok: true, latencyMs: 12 });
  const metric = (i: number) => ({ deviceId: `clh${String(i).padStart(22, '0')}`, metric: 'latency_ms', value: 12 });
  const post = (body: unknown) =>
    request(app.getHttpServer()).post('/v1/monitoring/ingest').set('x-ingest-token', 'test').send(body as object);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [IngestController],
      providers: [
        { provide: IngestService, useValue: { ingestBatch } },
        { provide: IngestTokenService, useValue: { createOrRotate: jest.fn() } },
      ],
    })
      // The token guard is exercised by ingest-token.guard.spec.ts; here it just supplies the org.
      .overrideGuard(IngestTokenGuard)
      .useValue({
        canActivate: (ctx: { switchToHttp: () => { getRequest: () => { ingestOrgId: string } } }) => {
          ctx.switchToHttp().getRequest().ingestOrgId = 'org-1';
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    (app as NestExpressApplication).useBodyParser('json', { limit: INGEST_BODY_LIMIT });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => { ingestBatch.mockClear(); });

  // --- the original bug, at the size that used to destroy data -----------------------------------

  it('accepts a 800-device batch - the size that used to 413 against the silent 100 kB default', async () => {
    const checks = Array.from({ length: 800 }, (_, i) => check(i));
    const metrics = Array.from({ length: 800 }, (_, i) => metric(i));
    // Sanity: this body really is over body-parser's 100 kB default, i.e. it really would have
    // been rejected before. If this ever stops holding, the test below stops proving anything.
    expect(Buffer.byteLength(JSON.stringify({ checks, metrics }))).toBeGreaterThan(100 * 1024);

    await post({ checks, metrics }).expect(202);
    expect(ingestBatch).toHaveBeenCalledTimes(1);
  });

  // --- item caps: over-cap must be 413 (retryable), never 400 (which the agent drops) ------------

  it(`accepts a batch exactly at the caps (${INGEST_MAX_CHECKS_PER_BATCH} checks / ${INGEST_MAX_METRICS_PER_BATCH} metrics)`, () =>
    post({
      checks: Array.from({ length: INGEST_MAX_CHECKS_PER_BATCH }, (_, i) => check(i)),
      metrics: Array.from({ length: INGEST_MAX_METRICS_PER_BATCH }, (_, i) => metric(i)),
    }).expect(202));

  it('rejects one check over the cap with 413, NOT 400 - 400 makes the agent drop the data', async () => {
    const res = await post({ checks: Array.from({ length: INGEST_MAX_CHECKS_PER_BATCH + 1 }, (_, i) => check(i)) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('GEN_005');
    expect(ingestBatch).not.toHaveBeenCalled();
  });

  it('rejects one metric over the cap with 413', async () => {
    const res = await post({ metrics: Array.from({ length: INGEST_MAX_METRICS_PER_BATCH + 1 }, (_, i) => metric(i)) });
    expect(res.status).toBe(413);
    expect(ingestBatch).not.toHaveBeenCalled();
  });

  it('rejects a body over the byte limit with 413', async () => {
    // Within the item caps but absurdly large per item: the byte ceiling still holds the line.
    const res = await post({
      metrics: Array.from({ length: 100 }, (_, i) => ({ ...metric(i), metric: 'x'.repeat(20_000) })),
    });
    expect(res.status).toBe(413);
    expect(ingestBatch).not.toHaveBeenCalled();
  });

  // --- field bounds: malformed is 400 (permanent), and must stay distinguishable from 413 --------

  it.each([
    ['missing deviceId', { checks: [{ ok: true }] }],
    ['wrong type for ok', { checks: [{ deviceId: 'd1', ok: 'yes' }] }],
    ['negative latency', { checks: [{ deviceId: 'd1', ok: true, latencyMs: -1 }] }],
    ['NaN metric value', { metrics: [{ deviceId: 'd1', metric: 'latency_ms', value: 'NaN' }] }],
    ['unknown property', { checks: [{ deviceId: 'd1', ok: true, evil: 1 }] }],
    ['checks not an array', { checks: { deviceId: 'd1', ok: true } }],
  ])('rejects %s with 400 (malformed, not oversized)', async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(ingestBatch).not.toHaveBeenCalled();
  });

  it('accepts a 64-bit SNMP counter value (no upper bound on metric value)', () =>
    post({ metrics: [{ deviceId: 'd1', metric: 'if_hc_in_octets.1', value: 1.8e19 }] }).expect(202));

  // --- the wire shape must be untouched by all of the above ---------------------------------------

  it('passes the batch through unchanged (wire shape preserved)', async () => {
    const body = {
      checks: [{ deviceId: 'd1', ok: false, latencyMs: 5, source: 'probe' }],
      metrics: [{ deviceId: 'd1', metric: 'sys_uptime', value: 1.5, ts: '2026-07-14T00:00:00.000Z' }],
    };
    await post(body).expect(202);
    const [orgId, checks, metrics] = ingestBatch.mock.calls[0];
    expect(orgId).toBe('org-1');
    expect({ ...checks[0] }).toEqual(body.checks[0]);
    expect({ ...metrics[0] }).toEqual(body.metrics[0]);
  });
});
