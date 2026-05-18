/**
 * E2E tests for /api/bandwidth/echo.
 *
 * This endpoint exists so the browser collector can measure download
 * (GET → fixed-size payload) and upload (POST → drain body) bandwidth
 * without depending on /api/health (which would either fail with a
 * method mismatch on POST, or grow a second responsibility).
 *
 * No DB / Redis dependency — the module boots in isolation.
 */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { BandwidthModule } from '../bandwidth.module';

const PAYLOAD_BYTES = 1_000_000;

describe('BandwidthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [BandwidthModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/bandwidth/echo', () => {
    it('returns 200', async () => {
      const res = await request(app.getHttpServer()).get('/api/bandwidth/echo');
      expect(res.status).toBe(200);
    });

    it('sets Content-Type application/octet-stream', async () => {
      const res = await request(app.getHttpServer()).get('/api/bandwidth/echo');
      expect(res.header['content-type']).toContain('application/octet-stream');
    });

    it('returns a payload of the configured size', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/bandwidth/echo')
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect((res.body as Buffer).length).toBe(PAYLOAD_BYTES);
    });

    it('sets Content-Length header matching the payload size', async () => {
      const res = await request(app.getHttpServer()).get('/api/bandwidth/echo');
      expect(res.header['content-length']).toBe(String(PAYLOAD_BYTES));
    });

    it('sets Cache-Control: no-store so measurements never come from cache', async () => {
      const res = await request(app.getHttpServer()).get('/api/bandwidth/echo');
      expect(res.header['cache-control']).toContain('no-store');
    });
  });

  describe('POST /api/bandwidth/echo', () => {
    it('returns 204 No Content on a small body', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/bandwidth/echo')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.alloc(1024));
      expect(res.status).toBe(204);
    });

    it('drains a 100KB body without buffering it as JSON', async () => {
      const payload = Buffer.alloc(100_000);
      const res = await request(app.getHttpServer())
        .post('/api/bandwidth/echo')
        .set('Content-Type', 'application/octet-stream')
        .send(payload);
      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
    });

    it('returns 204 even with an empty body', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/bandwidth/echo')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.alloc(0));
      expect(res.status).toBe(204);
    });
  });
});
