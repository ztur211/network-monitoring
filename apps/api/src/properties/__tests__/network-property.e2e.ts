import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E tests for /api/v1/networks/:networkId/properties (charter) endpoints.
 * Also covers ContainmentService's PROP_007 / PROP_008 enforcement.
 * Requires running test database and Redis.
 */
describe('NetworkProperty (charters) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerCookie: string;
  let orgId: string;
  let networkId: string;
  let siteId: string;
  let unrelatedSiteId: string;

  const ownerEmail = `e2e-charter-owner-${Date.now()}@x.com`;
  const password = 'Password123!';

  const pickCookie = (res: request.Response): string => {
    const c = res.headers['set-cookie'];
    return Array.isArray(c) ? c[0] : (c as unknown as string);
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);

    ownerCookie = pickCookie(
      await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: ownerEmail, password, name: 'Owner' }),
    );

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const org = await prisma.organization.create({ data: { name: `E2E Charter ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: owner.id, organizationId: orgId, role: 'OWNER' } });

    const network = await prisma.network.create({ data: { organizationId: orgId, userId: owner.id, name: `Net ${Date.now()}` } });
    networkId = network.id;

    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `HQ ${Date.now()}` } });
    siteId = site.id;

    const unrelatedSite = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `Remote ${Date.now()}` } });
    unrelatedSiteId = unrelatedSite.id;
  });

  afterAll(async () => {
    await prisma.device.deleteMany({ where: { organizationId: orgId } });
    await prisma.networkProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.network.deleteMany({ where: { organizationId: orgId } });
    await prisma.property.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: ownerEmail } });
    await app.close();
  });

  describe('POST /api/v1/networks/:networkId/properties', () => {
    it('OWNER charters a network to a SITE → 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/networks/${networkId}/properties`)
        .set('Cookie', ownerCookie)
        .send({ propertyId: siteId })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.networkId).toBe(networkId);
      expect(res.body.data.propertyId).toBe(siteId);
    });

    it('duplicate charter → 409 PROP_006', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/networks/${networkId}/properties`)
        .set('Cookie', ownerCookie)
        .send({ propertyId: siteId })
        .expect(409);

      expect(res.body.error.code).toBe('PROP_006');
    });
  });

  describe('ContainmentService.assertDevicePlacement', () => {
    it('placing a device under the chartered site succeeds → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', ownerCookie)
        .send({ name: `Charter Device ${Date.now()}`, category: 'ROUTER', networkId, propertyId: siteId })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.propertyId).toBe(siteId);
    });

    it('placing a device under an UNRELATED site (no charter) → 422 PROP_007', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', ownerCookie)
        .send({ name: `Unchartered Device ${Date.now()}`, category: 'SWITCH', networkId, propertyId: unrelatedSiteId })
        .expect(422);

      expect(res.body.error.code).toBe('PROP_007');
    });
  });

  describe('DELETE /api/v1/networks/:networkId/properties/:propertyId', () => {
    it('removing a charter that still covers a placed device → 409 PROP_008', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/networks/${networkId}/properties/${siteId}`)
        .set('Cookie', ownerCookie)
        .expect(409);

      expect(res.body.error.code).toBe('PROP_008');
    });

    it('removing a charter with no placed devices succeeds → 200', async () => {
      // Charter the unrelated site first, then remove it (no devices placed there)
      await request(app.getHttpServer())
        .post(`/api/v1/networks/${networkId}/properties`)
        .set('Cookie', ownerCookie)
        .send({ propertyId: unrelatedSiteId })
        .expect(201);

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/networks/${networkId}/properties/${unrelatedSiteId}`)
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
    });
  });

  describe('GET /api/v1/networks/:networkId/properties', () => {
    it('lists current charters for a network → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/networks/${networkId}/properties`)
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      const charter = (res.body.data as Array<{ propertyId: string }>).find((c) => c.propertyId === siteId);
      expect(charter).toBeDefined();
    });
  });
});
