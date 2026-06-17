import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E for GET /api/v1/buildings/:propertyId/export/ifc (Spec 5).
 * Requires the docker test stack (DB :5433, Redis :6380). Run with: npm run test:e2e -- export.controller
 */
describe('ExportController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerCookie: string;
  let memberCookie: string;
  let orgId: string;
  let buildingId: string; // in scope for the member
  let outOfScopeBuildingId: string; // not assigned to the member
  const ownerEmail = `e2e-exp-owner-${Date.now()}@example.com`;
  const memberEmail = `e2e-exp-member-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const signUp = async (email: string, name: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: 'Password123!', name });
      const c = res.headers['set-cookie'];
      return Array.isArray(c) ? c[0] : c;
    };
    ownerCookie = await signUp(ownerEmail, 'Exp Owner');
    memberCookie = await signUp(memberEmail, 'Exp Member');

    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const org = await prisma.organization.create({ data: { name: `E2E Exp ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: ownerUser.id, organizationId: orgId, role: 'OWNER' } });
    const memberMember = await prisma.organizationMember.create({
      data: { userId: memberUser.id, organizationId: orgId, role: 'MEMBER' },
    });

    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'Campus' } });
    const building = await prisma.property.create({ data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'HQ' } });
    buildingId = building.id;
    const floor = await prisma.property.create({ data: { organizationId: orgId, parentId: building.id, type: 'FLOOR', name: 'F1' } });
    const otherBuilding = await prisma.property.create({ data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'Annex' } });
    outOfScopeBuildingId = otherBuilding.id;

    const net = await prisma.network.create({ data: { organizationId: orgId, name: 'Core' } });
    await prisma.device.create({
      data: { organizationId: orgId, name: 'SW1', category: 'SWITCH', propertyId: floor.id, networkId: net.id, x: 1, y: 2, z: 3, ipAddress: '10.0.0.5' },
    });
    await prisma.device.create({
      data: { organizationId: orgId, name: 'Unplaced', category: 'SWITCH', propertyId: floor.id, networkId: net.id },
    });

    // F3: grant the MEMBER scope at the HQ building only (not the Annex)
    await prisma.memberProperty.create({ data: { organizationId: orgId, memberId: memberMember.id, propertyId: building.id } });
  });

  afterAll(async () => {
    await prisma.device.deleteMany({ where: { organizationId: orgId } });
    await prisma.memberProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.network.deleteMany({ where: { organizationId: orgId } });
    await prisma.property.deleteMany({ where: { organizationId: orgId, type: 'FLOOR' } });
    await prisma.property.deleteMany({ where: { organizationId: orgId, type: 'BUILDING' } });
    await prisma.property.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await app.close();
  });

  it('OWNER downloads the building IFC with only placed devices', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/buildings/${buildingId}/export/ifc`)
      .set('Cookie', ownerCookie)
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.setEncoding('utf-8');
        r.on('data', (c: string) => (data += c));
        r.on('end', () => cb(null, data));
      })
      .expect(200);
    expect(res.headers['content-type']).toContain('application/x-step');
    expect(res.headers['content-disposition']).toContain('attachment; filename="HQ-network.ifc"');
    const body = res.body as string;
    expect(body.startsWith('ISO-10303-21;')).toBe(true);
    expect((body.match(/IFCBUILDINGELEMENTPROXY/g) ?? []).length).toBe(1); // only the placed device
  });

  it('an in-scope MEMBER may export', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/buildings/${buildingId}/export/ifc`)
      .set('Cookie', memberCookie)
      .expect(200);
  });

  it('an out-of-scope building → 404 for the MEMBER (invisible-not-forbidden)', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/buildings/${outOfScopeBuildingId}/export/ifc`)
      .set('Cookie', memberCookie)
      .expect(404);
  });
});
