import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E tests for /api/v1/device-connections/* endpoints.
 * Requires running test database and Redis.
 */
describe('ConnectionsController (e2e)', () => {
  let app: INestApplication;
  let sessionCookie: string;
  let deviceAId: string;
  let deviceBId: string;
  let connectionId: string;
  const testEmail = `e2e-conn-${Date.now()}@example.com`;

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

    const signUp = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: testEmail, password: 'Password123!', name: 'Connections Test User' });

    const setCookie = signUp.headers['set-cookie'];
    sessionCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;

    const [devA, devB] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({ name: 'Conn Src', category: 'ROUTER' }),
      request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({ name: 'Conn Dst', category: 'SWITCH' }),
    ]);
    deviceAId = devA.body.data.id;
    deviceBId = devB.body.data.id;
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await app.close();
  });

  describe('POST /api/v1/device-connections', () => {
    it('returns 201 with DeviceConnectionDto', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/device-connections')
        .set('Cookie', sessionCookie)
        .send({ sourceDeviceId: deviceAId, targetDeviceId: deviceBId, connectionType: 'ETHERNET' });

      expect(res.status).toBe(201);
      expect(res.body.data.connectionType).toBe('ETHERNET');
      connectionId = res.body.data.id;
    });

    it('returns 422 CONN_002 for self-connection', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/device-connections')
        .set('Cookie', sessionCookie)
        .send({ sourceDeviceId: deviceAId, targetDeviceId: deviceAId, connectionType: 'ETHERNET' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('CONN_002');
    });

    it('returns 409 CONN_003 for duplicate connection', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/device-connections')
        .set('Cookie', sessionCookie)
        .send({ sourceDeviceId: deviceAId, targetDeviceId: deviceBId, connectionType: 'ETHERNET' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONN_003');
    });
  });

  describe('GET /api/v1/device-connections', () => {
    it('returns list of connections', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/device-connections')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThan(0);
    });
  });

  describe('PATCH /api/v1/device-connections/:id', () => {
    it('returns 200 with updated connection', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/device-connections/${connectionId}`)
        .set('Cookie', sessionCookie)
        .send({
          baseVersion: 1,
          changes: [{ field: 'notes', oldValue: null, newValue: 'Updated' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.notes).toBe('Updated');
    });
  });

  describe('DELETE /api/v1/device-connections/:id', () => {
    it('returns 200 and removes connection', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/device-connections/${connectionId}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
    });
  });
});
