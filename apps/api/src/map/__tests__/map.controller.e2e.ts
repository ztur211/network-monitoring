import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E tests for /api/v1/map/* endpoints.
 * Requires running test database with PostGIS and Redis.
 */
describe('MapController (e2e)', () => {
  let app: INestApplication;
  let sessionCookie: string;
  let orgId: string;
  let networkId: string;
  let siteId: string;
  const testEmail = `e2e-map-${Date.now()}@example.com`;

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
      .send({ email: testEmail, password: 'Password123!', name: 'Map Test User' });

    const setCookie = signUp.headers['set-cookie'];
    sessionCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;

    const prisma = app.get(PrismaService);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: testEmail } });
    const org = await prisma.organization.create({ data: { name: `E2E Map ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: u.id, organizationId: orgId, role: 'OWNER' } });

    const network = await prisma.network.create({ data: { organizationId: orgId, userId: u.id, name: `Net ${Date.now()}` } });
    networkId = network.id;
    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `HQ ${Date.now()}` } });
    siteId = site.id;
    await prisma.networkProperty.create({ data: { organizationId: orgId, networkId: network.id, propertyId: site.id } });
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.device.deleteMany({ where: { organizationId: orgId } });
    await prisma.networkProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.network.deleteMany({ where: { organizationId: orgId } });
    await prisma.property.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await app.close();
  });

  describe('GET /api/v1/map/devices', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/map/devices?bbox=-180,-90,180,90');
      expect(res.status).toBe(401);
    });

    it('returns 200 with empty items for new user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/map/devices?bbox=-180,-90,180,90')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toBeDefined();
    });

    it('returns 400 GEN_001 for missing bbox', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/map/devices')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(400);
    });

    it('returns device with location in bbox', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({ name: 'Map Test Router', category: 'ROUTER', latitude: 40.7128, longitude: -74.006, networkId, propertyId: siteId });

      const res = await request(app.getHttpServer())
        .get('/api/v1/map/devices?bbox=-75,-90,-73,41')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      const found = res.body.data.items.find((d: { name: string }) => d.name === 'Map Test Router');
      expect(found).toBeDefined();
    });
  });

  describe('GET /api/v1/map/fiber-runs', () => {
    it('returns 200 with items array', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/map/fiber-runs?bbox=-180,-90,180,90')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });
  });

  describe('GET /api/v1/map/circuits', () => {
    it('returns 200 with items array', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/map/circuits?bbox=-180,-90,180,90')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });
  });
});
