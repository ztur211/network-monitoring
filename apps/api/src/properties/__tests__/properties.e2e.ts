import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

describe('Properties (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerCookie: string;
  let memberCookie: string;
  let orgId: string;

  const ownerEmail = `e2e-prop-owner-${Date.now()}@x.com`;
  const memberEmail = `e2e-prop-member-${Date.now()}@x.com`;
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
    memberCookie = pickCookie(
      await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: memberEmail, password, name: 'Member' }),
    );

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const member = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const org = await prisma.organization.create({ data: { name: `E2E Properties ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: owner.id, organizationId: orgId, role: 'OWNER' } });
    await prisma.organizationMember.create({ data: { userId: member.id, organizationId: orgId, role: 'MEMBER' } });
  });

  afterAll(async () => {
    await prisma.property.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, memberEmail] } } });
    await app.close();
  });

  let siteId: string;
  let buildingId: string;

  it('OWNER creates a SITE → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Cookie', ownerCookie)
      .send({ type: 'SITE', name: 'HQ', code: 'hq' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.type).toBe('SITE');
    siteId = res.body.data.id as string;
  });

  it('OWNER creates a BUILDING under SITE → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Cookie', ownerCookie)
      .send({ type: 'BUILDING', name: 'Tower A', parentId: siteId })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.parentId).toBe(siteId);
    buildingId = res.body.data.id as string;
  });

  it('illegal nesting: FLOOR directly under SITE → 422 PROP_002', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Cookie', ownerCookie)
      .send({ type: 'FLOOR', name: 'Floor 1', parentId: siteId })
      .expect(422);

    expect(res.body.error.code).toBe('PROP_002');
  });

  it('duplicate sibling name (case-insensitive) → 409 PROP_003', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Cookie', ownerCookie)
      .send({ type: 'BUILDING', name: 'tower a', parentId: siteId })
      .expect(409);

    expect(res.body.error.code).toBe('PROP_003');
  });

  it('delete SITE with child → 409 PROP_004', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/properties/${siteId}`)
      .set('Cookie', ownerCookie)
      .expect(409);

    expect(res.body.error.code).toBe('PROP_004');
  });

  it('MEMBER GET /properties → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties')
      .set('Cookie', memberCookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('MEMBER POST /properties → 403 ORG_003', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Cookie', memberCookie)
      .send({ type: 'SITE', name: 'Nope' })
      .expect(403);

    expect(res.body.error.code).toBe('ORG_003');
  });

  it('cleanup: delete building then site → 200 each', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/properties/${buildingId}`)
      .set('Cookie', ownerCookie)
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/v1/properties/${siteId}`)
      .set('Cookie', ownerCookie)
      .expect(200);
  });
});
