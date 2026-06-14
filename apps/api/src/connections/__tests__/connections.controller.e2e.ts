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
  let memberCookie: string;
  let deviceAId: string;
  let deviceBId: string;
  let connectionId: string;
  let orgId: string;
  let networkId: string;
  let siteId: string;
  const testEmail = `e2e-conn-${Date.now()}@example.com`;
  const memberEmail = `e2e-conn-member-${Date.now()}@example.com`;

  const pickCookie = (res: request.Response): string => {
    const c = res.headers['set-cookie'];
    return Array.isArray(c) ? c[0] : (c as unknown as string);
  };

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

    sessionCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: testEmail, password: 'Password123!', name: 'Connections Test User' }),
    );

    memberCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: memberEmail, password: 'Password123!', name: 'Connections Member User' }),
    );

    const prisma = app.get(PrismaService);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: testEmail } });
    const member = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const org = await prisma.organization.create({ data: { name: `E2E Connections ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: u.id, organizationId: orgId, role: 'OWNER' } });
    await prisma.organizationMember.create({ data: { userId: member.id, organizationId: orgId, role: 'MEMBER' } });

    const network = await prisma.network.create({ data: { organizationId: orgId, userId: u.id, name: `Net ${Date.now()}` } });
    networkId = network.id;
    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `HQ ${Date.now()}` } });
    siteId = site.id;
    await prisma.networkProperty.create({ data: { organizationId: orgId, networkId: network.id, propertyId: site.id } });

    const [devA, devB] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({ name: 'Conn Src', category: 'ROUTER', networkId, propertyId: siteId }),
      request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({ name: 'Conn Dst', category: 'SWITCH', networkId, propertyId: siteId }),
    ]);
    deviceAId = devA.body.data.id;
    deviceBId = devB.body.data.id;
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.deviceConnection.deleteMany({ where: { organizationId: orgId } });
    await prisma.device.deleteMany({ where: { organizationId: orgId } });
    await prisma.networkProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.network.deleteMany({ where: { organizationId: orgId } });
    await prisma.property.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [testEmail, memberEmail] } } });
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

  describe('MEMBER read-only on connections', () => {
    it('MEMBER GET /api/v1/device-connections → 200 (read is allowed)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/device-connections')
        .set('Cookie', memberCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('MEMBER POST /api/v1/device-connections → 403 ORG_003', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/device-connections')
        .set('Cookie', memberCookie)
        .send({ sourceDeviceId: deviceAId, targetDeviceId: deviceBId, connectionType: 'ETHERNET' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });

    it('MEMBER PATCH /api/v1/device-connections/:id → 403 ORG_003', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/device-connections/00000000-0000-0000-0000-000000000001')
        .set('Cookie', memberCookie)
        .send({ baseVersion: 1, changes: [{ field: 'notes', oldValue: null, newValue: 'blocked' }] });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });

    it('MEMBER DELETE /api/v1/device-connections/:id → 403 ORG_003', async () => {
      const res = await request(app.getHttpServer())
        .delete('/api/v1/device-connections/00000000-0000-0000-0000-000000000001')
        .set('Cookie', memberCookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });
  });
});
