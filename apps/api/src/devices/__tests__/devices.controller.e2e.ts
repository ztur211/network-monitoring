import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';

/**
 * E2E tests for /api/v1/devices/* endpoints.
 * Requires running test database and Redis.
 */
describe('DevicesController (e2e)', () => {
  let app: INestApplication;
  let sessionCookie: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    const res = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: `e2e-devices-${Date.now()}@example.com`, password: 'Password123!' });

    const setCookie = res.headers['set-cookie'];
    sessionCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  });

  afterAll(async () => {
    await app.close();
  });

  let deviceId: string;

  describe('GET /api/v1/devices', () => {
    it('returns 401 AUTH_002 without auth', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/devices');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_002');
    });

    it('returns 200 with empty list for new user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/devices')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(0);
      expect(res.body.data.total).toBe(0);
    });
  });

  describe('POST /api/v1/devices', () => {
    it('returns 400 GEN_001 for missing required fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GEN_001');
    });

    it('returns 201 with DeviceDto on success', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({ name: 'Test Router', category: 'ROUTER' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Test Router');
      expect(res.body.data.version).toBe(1);
      deviceId = res.body.data.id;
    });

    it('returns 409 DEVICE_003 when name is already taken (case-insensitive)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({ name: 'test router', category: 'SWITCH' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DEVICE_003');
    });
  });

  describe('GET /api/v1/devices/:id', () => {
    it('returns 200 with DeviceDto for owned device', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices/${deviceId}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(deviceId);
    });

    it('returns 404 DEVICE_001 for non-existent device', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/devices/00000000-0000-0000-0000-000000000000')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('DEVICE_001');
    });
  });

  describe('PATCH /api/v1/devices/:id', () => {
    it('returns 200 with updated DeviceDto', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/devices/${deviceId}`)
        .set('Cookie', sessionCookie)
        .send({
          baseVersion: 1,
          changes: [{ field: 'notes', oldValue: null, newValue: 'Updated notes' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.notes).toBe('Updated notes');
      expect(res.body.data.version).toBe(2);
    });

    it('returns 409 SYNC_001 for version conflict', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/devices/${deviceId}`)
        .set('Cookie', sessionCookie)
        .send({
          baseVersion: 1,
          changes: [{ field: 'notes', oldValue: null, newValue: 'Stale update' }],
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SYNC_001');
    });
  });

  describe('DELETE /api/v1/devices/:id', () => {
    it('returns 200 and removes the device', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/devices/${deviceId}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it('returns 404 DEVICE_001 after deletion', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices/${deviceId}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(404);
    });
  });
});
