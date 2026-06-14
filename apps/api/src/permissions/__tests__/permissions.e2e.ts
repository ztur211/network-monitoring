import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

describe('Permissions access/me (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerCookie: string;
  let memberCookie: string;
  let orgId: string;
  let s1Id: string;

  const ownerEmail = `e2e-access-owner-${Date.now()}@x.com`;
  const memberEmail = `e2e-access-member-${Date.now()}@x.com`;
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

    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const org = await prisma.organization.create({ data: { name: `E2E Access ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: ownerUser.id, organizationId: orgId, role: 'OWNER' } });
    const memberMembership = await prisma.organizationMember.create({ data: { userId: memberUser.id, organizationId: orgId, role: 'MEMBER' } });

    const s1 = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'HQ' } });
    s1Id = s1.id;
    const team = await prisma.team.create({ data: { organizationId: orgId, name: 'NE', creatorMemberId: null } });
    await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: team.id, propertyId: s1Id } });
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: team.id, memberId: memberMembership.id } });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, memberEmail] } } });
    await app.close();
  });

  it('OWNER access summary is unscoped', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/access/me').set('Cookie', ownerCookie).expect(200);
    expect(res.body.data).toMatchObject({ role: 'OWNER', unscoped: true });
    expect(res.body.data.assignedRootPropertyIds).toEqual([]);
  });

  it('MEMBER access summary lists assigned roots', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/access/me').set('Cookie', memberCookie).expect(200);
    expect(res.body.data.role).toBe('MEMBER');
    expect(res.body.data.unscoped).toBe(false);
    expect(res.body.data.assignedRootPropertyIds).toContain(s1Id);
  });

  it('returns 401 without auth', async () => {
    await request(app.getHttpServer()).get('/api/v1/access/me').expect(401);
  });
});
