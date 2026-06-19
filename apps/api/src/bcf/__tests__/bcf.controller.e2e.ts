import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { writeBcfZip, ParsedTopic } from '../bcf-zip';

/**
 * E2E for BCF HTTP endpoints — Spec 6 Phase C Task 4.
 *
 * Scenarios:
 *  1. OWNER imports a .bcfzip → 201, topicsUpserted == 1
 *  2. In-scope MEMBER: GET topics → 200 (list non-empty)
 *  3. In-scope MEMBER: GET export → 200 (octet-stream)
 *  4. In-scope MEMBER: POST topics → 403 (ORG_003, MEMBER cannot mutate)
 *  5. Out-of-scope: GET topics for that building → 404 (PROP_001)
 *
 * Run: npm run test:e2e -- bcf.controller
 */

// Minimal valid 1×1 PNG (header only, 67 bytes)
const VALID_1X1_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080200000090' +
    '77533de0000000125044415478016360f8cfc000000000200016dd8a80000' +
    '000049454e44ae426082',
  'hex',
);

describe('BcfController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let orgId: string;
  let ownerCookie: string;
  let memberInScopeCookie: string;
  let outOfScopeCookie: string;

  let buildingId: string;

  const ownerEmail = `e2e-bcf-owner-${Date.now()}@example.com`;
  const memberInScopeEmail = `e2e-bcf-member-${Date.now()}@example.com`;
  const outOfScopeEmail = `e2e-bcf-outscope-${Date.now()}@example.com`;
  const password = 'Password123!';

  const pickCookie = (res: request.Response): string => {
    const c = res.headers['set-cookie'];
    return Array.isArray(c) ? c[0] : (c as unknown as string);
  };

  /** Build a minimal valid .bcfzip buffer (one topic, valid PNG snapshot). */
  async function buildSampleBcfZip(): Promise<Buffer> {
    const topic: ParsedTopic = {
      guid: `e2e-bcf-${Date.now()}-0000-0000-000000000001`,
      title: 'E2E clash topic',
      topicType: 'Clash',
      topicStatus: 'Open',
      labels: [],
      creationAuthor: ownerEmail,
      creationDate: new Date().toISOString(),
      comments: [],
      viewpoints: [
        {
          guid: `e2e-bcf-vp-${Date.now()}`,
          isPrimary: true,
          camera: {
            kind: 'perspective',
            position: [1, 2, 3],
            direction: [0, 0, -1],
            up: [0, 1, 0],
            fieldOfView: 60,
          },
          components: {
            selection: [],
            visibility: { defaultVisibility: true, exceptions: [] },
          },
          clippingPlanes: [],
          snapshotPng: VALID_1X1_PNG,
        },
      ],
    };
    return writeBcfZip([topic]);
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = moduleRef.get(PrismaService);

    // Sign up all three users
    ownerCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: ownerEmail, password, name: 'BcfOwner' }),
    );
    memberInScopeCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: memberInScopeEmail, password, name: 'BcfMember' }),
    );
    outOfScopeCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: outOfScopeEmail, password, name: 'BcfOutScope' }),
    );

    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberInScopeEmail } });
    const outScopeUser = await prisma.user.findUniqueOrThrow({ where: { email: outOfScopeEmail } });

    const org = await prisma.organization.create({
      data: { name: `E2E BCF Org ${Date.now()}` },
    });
    orgId = org.id;

    const ownerMembership = await prisma.organizationMember.create({
      data: { userId: ownerUser.id, organizationId: orgId, role: 'OWNER' },
    });
    const memberMembership = await prisma.organizationMember.create({
      data: { userId: memberUser.id, organizationId: orgId, role: 'MEMBER' },
    });
    // Out-of-scope user is ADMIN in the org but will NOT be scoped to the building
    await prisma.organizationMember.create({
      data: { userId: outScopeUser.id, organizationId: orgId, role: 'ADMIN' },
    });

    // Create property tree: site → building
    const site = await prisma.property.create({
      data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'BCF E2E Site' },
    });
    const building = await prisma.property.create({
      data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'BCF E2E Building' },
    });
    buildingId = building.id;

    // F3 scoping: create a team scoped to the building and add the in-scope member
    const team = await prisma.team.create({
      data: { organizationId: orgId, name: 'BCF Team', creatorMemberId: ownerMembership.id },
    });
    await prisma.teamProperty.create({
      data: { organizationId: orgId, teamId: team.id, propertyId: buildingId },
    });
    await prisma.teamMember.create({
      data: { organizationId: orgId, teamId: team.id, memberId: memberMembership.id },
    });
    // Note: outOfScopeUser (ADMIN) is NOT added to any team → out of scope for building
  });

  afterAll(async () => {
    // Clean up in dependency order
    await prisma.bcfTopicDevice.deleteMany({
      where: { topic: { organizationId: orgId } },
    });
    await prisma.bcfComment.deleteMany({ where: { organizationId: orgId } });
    await prisma.bcfViewpoint.deleteMany({ where: { organizationId: orgId } });
    await prisma.bcfTopic.deleteMany({ where: { organizationId: orgId } });
    await prisma.teamMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.teamProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.team.deleteMany({ where: { organizationId: orgId } });
    await prisma.property.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({
      where: { email: { in: [ownerEmail, memberInScopeEmail, outOfScopeEmail] } },
    });
    await app.close();
  });

  // ─── OWNER: import ────────────────────────────────────────────────────────

  it('OWNER imports a .bcfzip → 201, topicsUpserted == 1', async () => {
    const buf = await buildSampleBcfZip();

    const res = await request(app.getHttpServer())
      .post(`/api/v1/buildings/${buildingId}/bcf/import`)
      .set('Cookie', ownerCookie)
      .attach('file', buf, 'in.bcfzip')
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.topicsUpserted).toBe(1);
    expect(res.body.timestamp).toBeDefined();
  });

  // ─── In-scope MEMBER: reads ───────────────────────────────────────────────

  it('in-scope MEMBER: GET topics → 200, list non-empty', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/buildings/${buildingId}/bcf/topics`)
      .set('Cookie', memberInScopeCookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('in-scope MEMBER: GET export → 200, Content-Type application/octet-stream', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/buildings/${buildingId}/bcf/export`)
      .set('Cookie', memberInScopeCookie)
      .expect(200);

    expect(res.headers['content-type']).toContain('application/octet-stream');
  });

  // ─── In-scope MEMBER: mutation gated (ORG_003) ────────────────────────────

  it('in-scope MEMBER: POST topics → 403 (ORG_003, MEMBER cannot author topics)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/buildings/${buildingId}/bcf/topics`)
      .set('Cookie', memberInScopeCookie)
      .send({ title: 'MEMBER attempt' })
      .expect(403);

    expect(res.body.error.code).toBe('ORG_003');
  });

  // ─── Out-of-scope ADMIN: GET topics → 404 (PROP_001) ─────────────────────

  it('out-of-scope ADMIN: GET topics → 404 (PROP_001, building not in scope)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/buildings/${buildingId}/bcf/topics`)
      .set('Cookie', outOfScopeCookie)
      .expect(404);

    expect(res.body.error.code).toBe('PROP_001');
  });
});
