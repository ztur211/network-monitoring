import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E for PATCH /api/v1/devices/:id/position — device 3D placement (Spec 1 Phase C).
 * Requires the docker test stack (DB :5433, Redis :6380, MinIO :9100).
 */
const VALID_IFC = Buffer.from('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');

describe('SpatialController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerCookie: string;
  let memberCookie: string;
  let orgId: string;
  let networkId: string;
  let deviceInModeledId: string;
  let deviceUnmodeledId: string;

  const ownerEmail = `e2e-spatial-owner-${Date.now()}@example.com`;
  const memberEmail = `e2e-spatial-member-${Date.now()}@example.com`;

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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    // Auth: sign up owner and member
    ownerCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: ownerEmail, password: 'Password123!', name: 'Spatial Owner' }),
    );
    memberCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: memberEmail, password: 'Password123!', name: 'Spatial Member' }),
    );

    // Seed org, members, network
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const org = await prisma.organization.create({ data: { name: `E2E Spatial ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: ownerUser.id, organizationId: orgId, role: 'OWNER' } });
    await prisma.organizationMember.create({ data: { userId: memberUser.id, organizationId: orgId, role: 'MEMBER' } });

    const network = await prisma.network.create({
      data: { organizationId: orgId, userId: ownerUser.id, name: `Net ${Date.now()}` },
    });
    networkId = network.id;

    // Property tree:
    //   SITE → B1 (BUILDING with model) → F1 (FLOOR)
    //   SITE → B2 (BUILDING without model)
    const site = await prisma.property.create({
      data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'HQ' },
    });
    const b1 = await prisma.property.create({
      data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'Tower A' },
    });
    const f1 = await prisma.property.create({
      data: { organizationId: orgId, parentId: b1.id, type: 'FLOOR', name: 'Level 1' },
    });
    const b2 = await prisma.property.create({
      data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'Tower B (no model)' },
    });

    // Charter the network to the site so ContainmentService accepts device placement
    await prisma.networkProperty.create({
      data: { organizationId: orgId, networkId: network.id, propertyId: site.id },
    });

    // Upload + activate a building model on B1 via HTTP (mirrors building-models.e2e.ts)
    const upload = await request(app.getHttpServer())
      .post(`/api/v1/buildings/${b1.id}/model/versions?fileName=test.ifc`)
      .set('Cookie', ownerCookie)
      .set('Content-Type', 'application/octet-stream')
      .send(VALID_IFC);
    // First upload auto-activates v1, so the model is already active — no PUT needed
    if (upload.status !== 201) {
      throw new Error(`Model upload failed: ${JSON.stringify(upload.body)}`);
    }

    // Device under F1 (under B1 which has an active model)
    const devModeled = await prisma.device.create({
      data: {
        organizationId: orgId,
        userId: ownerUser.id,
        networkId,
        propertyId: f1.id,
        name: `Dev Modeled ${Date.now()}`,
        category: 'ROUTER',
      },
    });
    deviceInModeledId = devModeled.id;

    // Device under B2 (no model) — triggers SPATIAL_001
    const devUnmodeled = await prisma.device.create({
      data: {
        organizationId: orgId,
        userId: ownerUser.id,
        networkId,
        propertyId: b2.id,
        name: `Dev Unmodeled ${Date.now()}`,
        category: 'SWITCH',
      },
    });
    deviceUnmodeledId = devUnmodeled.id;
  });

  afterAll(async () => {
    // Cascade via org delete (members, devices, properties, models all cascade)
    if (orgId) {
      // Delete model versions + models first (FK to property)
      await prisma.buildingModelVersion.deleteMany({ where: { organizationId: orgId } });
      await prisma.buildingModel.deleteMany({ where: { organizationId: orgId } });
      await prisma.device.deleteMany({ where: { organizationId: orgId } });
      await prisma.networkProperty.deleteMany({ where: { organizationId: orgId } });
      await prisma.network.deleteMany({ where: { organizationId: orgId } });
      await prisma.property.deleteMany({ where: { organizationId: orgId } });
      await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, memberEmail] } } });
    await app.close();
  });

  describe('PATCH /api/v1/devices/:id/position', () => {
    it('sets x/y/z — returns 200 with data.x, data.y, data.z populated', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/devices/${deviceInModeledId}/position`)
        .set('Cookie', ownerCookie)
        .send({ x: 1.5, y: 2, z: 3 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.x).toBe(1.5);
      expect(res.body.data.y).toBe(2);
      expect(res.body.data.z).toBe(3);
      expect(typeof res.body.timestamp).toBe('string');
    });

    it('clears x/y/z — {x:null,y:null,z:null} returns 200 with data.x === null', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/devices/${deviceInModeledId}/position`)
        .set('Cookie', ownerCookie)
        .send({ x: null, y: null, z: null });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.x).toBeNull();
      expect(res.body.data.y).toBeNull();
      expect(res.body.data.z).toBeNull();
    });

    it('partial triple (x+y, no z) → 422 SPATIAL_002', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/devices/${deviceInModeledId}/position`)
        .set('Cookie', ownerCookie)
        .send({ x: 1, y: 2, z: null });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SPATIAL_002');
    });

    it('device under un-modeled building → 422 SPATIAL_001', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/devices/${deviceUnmodeledId}/position`)
        .set('Cookie', ownerCookie)
        .send({ x: 1, y: 2, z: 3 });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SPATIAL_001');
    });

    it('MEMBER (not OWNER/ADMIN) → 403', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/devices/${deviceInModeledId}/position`)
        .set('Cookie', memberCookie)
        .send({ x: 1, y: 2, z: 3 });

      expect(res.status).toBe(403);
      // Log the code so we know what OrgRoleGuard returns (ORG_003 expected)
      console.log('MEMBER 403 code:', res.body.error?.code);
    });
  });
});
