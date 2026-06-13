import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E tests for /api/v1/devices/* endpoints.
 * Requires running test database and Redis.
 */
describe('DevicesController (e2e)', () => {
  let app: INestApplication;
  let sessionCookie: string;
  let orgId: string;
  const testEmail = `e2e-devices-${Date.now()}@example.com`;

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
      .send({ email: testEmail, password: 'Password123!', name: 'Devices Test User' });

    const setCookie = res.headers['set-cookie'];
    sessionCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;

    const prisma = app.get(PrismaService);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: testEmail } });
    const org = await prisma.organization.create({ data: { name: `E2E Devices ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: u.id, organizationId: orgId, role: 'OWNER' } });
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: testEmail } });
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

    it('returns 409 ORG_005 when name is already taken in org (case-insensitive)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({ name: 'test router', category: 'SWITCH' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORG_005');
    });

    it('replays a create idempotently — same Idempotency-Key returns the original row, no duplicate', async () => {
      const key = 'e2e-idem-key-1';
      const body = { name: 'Idempotent AP', category: 'ACCESS_POINT' };

      const first = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .set('Idempotency-Key', key)
        .send(body);
      expect(first.status).toBe(201);
      const firstId = first.body.data.id;

      // Same key + same body. Without idempotency this would be 409 DEVICE_003
      // (name already taken); instead it returns the cached original response.
      const replay = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .set('Idempotency-Key', key)
        .send(body);
      expect(replay.status).toBe(201);
      expect(replay.body.data.id).toBe(firstId);

      // Exactly one device with that name exists — the replay created nothing.
      const list = await request(app.getHttpServer())
        .get('/api/v1/devices')
        .set('Cookie', sessionCookie);
      const matches = list.body.data.items.filter(
        (d: { name: string }) => d.name === 'Idempotent AP',
      );
      expect(matches).toHaveLength(1);
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

  describe('Audit ALS end-to-end', () => {
    it('writes a ChangeLog CREATE row with the session actor (ALS end-to-end)', async () => {
      const prisma = app.get(PrismaService);

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({ name: `AuditE2E ${Date.now()}`, category: 'ROUTER' })
        .expect(201);

      const newId = res.body.data.id;

      const u = await prisma.user.findUniqueOrThrow({ where: { email: testEmail } });
      const logs = await prisma.changeLog.findMany({
        where: { entityType: 'Device', entityId: newId, action: 'CREATE' },
      });

      expect(logs).toHaveLength(1);
      // AuthGuard must have populated userId in the ALS store
      expect(logs[0].userId).toBe(u.id);
      // AuditContextMiddleware must have populated a real requestId (not the fallback 'unknown')
      expect(logs[0].requestId).not.toBe('unknown');
      expect(logs[0].requestId.length).toBeGreaterThan(0);
    });
  });
});
