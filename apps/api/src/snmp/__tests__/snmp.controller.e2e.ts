import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E for SnmpController credential + profile CRUD.
 *
 * POST   /v1/snmp/credentials         — create
 * GET    /v1/snmp/credentials         — list (secrets NEVER in response)
 * DELETE /v1/snmp/credentials/:id     — delete; 409 SNMP_003 if assigned
 * POST   /v1/snmp/profiles            — create
 * GET    /v1/snmp/profiles            — list
 * DELETE /v1/snmp/profiles/:id        — delete; 409 SNMP_003 if assigned
 *
 * Role gating: MEMBER → 403 on write endpoints.
 * Secret safety: JSON.stringify(listResponse) must never contain community string.
 *
 * Run: npm run test:e2e -- snmp.controller
 */
describe('SnmpController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let orgId: string;
  let ownerCookie: string;
  let memberCookie: string;

  const ownerEmail = `e2e-snmp-ctrl-owner-${Date.now()}@example.com`;
  const memberEmail = `e2e-snmp-ctrl-member-${Date.now()}@example.com`;
  const password = 'Password123!';

  const pickCookie = (res: request.Response): string => {
    const c = res.headers['set-cookie'];
    return Array.isArray(c) ? c[0] : (c as unknown as string);
  };

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

    ownerCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: ownerEmail, password, name: 'SnmpOwner' }),
    );
    memberCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: memberEmail, password, name: 'SnmpMember' }),
    );

    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });

    const org = await prisma.organization.create({ data: { name: `E2E Snmp Ctrl Org ${Date.now()}` } });
    orgId = org.id;

    await prisma.organizationMember.createMany({
      data: [
        { userId: ownerUser.id, organizationId: orgId, role: 'OWNER' },
        { userId: memberUser.id, organizationId: orgId, role: 'MEMBER' },
      ],
    });
  });

  afterAll(async () => {
    // Cascade: devices and networks hold foreign keys to credentials/profiles.
    // Detach any assignments first, then delete credentials/profiles, then org.
    await prisma.snmpCredential.deleteMany({ where: { organizationId: orgId } });
    await prisma.oidProfile.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, memberEmail] } } });
    await app.close();
  });

  // ─── Credential CRUD ──────────────────────────────────────────────────────

  describe('credential CRUD', () => {
    let credId: string;

    it('POST /v1/snmp/credentials → 201 + hasCommunity===true', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/snmp/credentials')
        .set('Cookie', ownerCookie)
        .send({ name: 'core-v2c', snmpVersion: 'V2C', community: 'public' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.hasCommunity).toBe(true);
      expect(res.body.data.id).toBeTruthy();
      expect(res.body.timestamp).toBeDefined();
      credId = res.body.data.id;
    });

    it('GET /v1/snmp/credentials → 200 + list; secret never in JSON', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/snmp/credentials')
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      // The response body JSON must not contain the plaintext community string
      const jsonStr = JSON.stringify(res.body);
      expect(jsonStr).not.toContain('public'); // the plaintext community value
      expect(jsonStr).not.toContain('communityEnc'); // the raw encrypted column name

      // But presence boolean should be true
      const found = res.body.data.find((c: { id: string }) => c.id === credId);
      expect(found).toBeDefined();
      expect(found.hasCommunity).toBe(true);
    });

    it('DELETE /v1/snmp/credentials/:id → 200 (unassigned credential)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/snmp/credentials/${credId}`)
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(credId);
    });

    it('DELETE /v1/snmp/credentials/:id → 409 SNMP_003 when credential is assigned to a network', async () => {
      // Seed a credential and assign it to a network
      const assignedCred = await prisma.snmpCredential.create({
        data: {
          organizationId: orgId,
          name: 'assigned-cred',
          snmpVersion: 'V2C',
          communityEnc: 'BLOB_ENC',
        },
      });
      const net = await prisma.network.create({
        data: { organizationId: orgId, name: 'Net_With_Cred', snmpCredentialId: assignedCred.id },
      });

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/snmp/credentials/${assignedCred.id}`)
        .set('Cookie', ownerCookie)
        .expect(409);

      expect(res.body.error.code).toBe('SNMP_003');

      // Cleanup
      await prisma.network.delete({ where: { id: net.id } });
      await prisma.snmpCredential.delete({ where: { id: assignedCred.id } });
    });
  });

  // ─── OID Profile CRUD ─────────────────────────────────────────────────────

  describe('OID profile CRUD', () => {
    let profileId: string;

    it('POST /v1/snmp/profiles → 201 + profile with entries', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/snmp/profiles')
        .set('Cookie', ownerCookie)
        .send({
          name: 'std-profile',
          includeInterfaceMetrics: false,
          entries: [{ oid: '1.3.6.1.2.1.1.5.0', metric: 'sysname' }],
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('std-profile');
      expect(Array.isArray(res.body.data.entries)).toBe(true);
      expect(res.body.data.entries).toHaveLength(1);
      profileId = res.body.data.id;
    });

    it('GET /v1/snmp/profiles → 200 + list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/snmp/profiles')
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      const found = res.body.data.find((p: { id: string }) => p.id === profileId);
      expect(found).toBeDefined();
    });

    it('DELETE /v1/snmp/profiles/:id → 200 (unassigned profile)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/snmp/profiles/${profileId}`)
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(profileId);
    });

    it('DELETE /v1/snmp/profiles/:id → 409 SNMP_003 when profile is assigned to a network', async () => {
      const assignedProf = await prisma.oidProfile.create({
        data: { organizationId: orgId, name: 'assigned-profile', includeInterfaceMetrics: false },
      });
      const net = await prisma.network.create({
        data: { organizationId: orgId, name: 'Net_With_Prof', oidProfileId: assignedProf.id },
      });

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/snmp/profiles/${assignedProf.id}`)
        .set('Cookie', ownerCookie)
        .expect(409);

      expect(res.body.error.code).toBe('SNMP_003');

      // Cleanup
      await prisma.network.delete({ where: { id: net.id } });
      await prisma.oidProfile.delete({ where: { id: assignedProf.id } });
    });
  });

  // ─── MEMBER role gating ───────────────────────────────────────────────────

  describe('MEMBER access (403 on write endpoints)', () => {
    it('POST /v1/snmp/credentials → 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/snmp/credentials')
        .set('Cookie', memberCookie)
        .send({ name: 'member-cred', snmpVersion: 'V2C', community: 'pub' })
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('GET /v1/snmp/credentials → 403', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/snmp/credentials')
        .set('Cookie', memberCookie)
        .expect(403);
    });

    it('POST /v1/snmp/assign → 403', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/snmp/assign')
        .set('Cookie', memberCookie)
        .send({ targetType: 'network', targetId: 'some-id' })
        .expect(403);
    });
  });
});
