import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E for POST /v1/snmp/assign — F3-scoped assignment of SNMP credentials/profiles
 * to networks and devices.
 *
 * Scenarios:
 *  1. OWNER assigns a credential to a network → 200, network.snmpCredentialId set
 *  2. OWNER assigns a credential to a device → 200, device.snmpCredentialId set
 *  3. ADMIN out-of-scope on device (siteB) → 403 PERM_001
 *  4. Credential from wrong org → 404 SNMP_001
 *  5. Body missing snmpCredentialId/oidProfileId → 400
 *  6. ADMIN (siteA only) assigns to network with device footprint in siteB → 403 PERM_004
 *
 * Run: npm run test:e2e -- snmp.assignment
 */
describe('SnmpController assign (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let orgId: string;
  let ownerCookie: string;
  let adminCookie: string;  // ADMIN scoped to siteA only

  const ownerEmail = `e2e-snmp-assign-owner-${Date.now()}@example.com`;
  const adminEmail = `e2e-snmp-assign-admin-${Date.now()}@example.com`;
  const password = 'Password123!';

  /** network used for assignment tests (chartered siteA only) */
  let networkId: string;
  /** network whose device footprint spills into siteB (used for PERM_004 test) */
  let networkBSpillId: string;
  /** device under siteA (within ADMIN scope) */
  let deviceIdInScope: string;
  /** device under siteB (outside ADMIN scope) */
  let deviceIdOutScope: string;
  /** credential belonging to this org */
  let credentialId: string;
  /** siteA id (ADMIN is scoped here) */
  let siteAId: string;
  /** siteB id (ADMIN is NOT scoped here) */
  let siteBId: string;

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
        .send({ email: ownerEmail, password, name: 'AssignOwner' }),
    );
    adminCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: adminEmail, password, name: 'AssignAdmin' }),
    );

    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });

    const org = await prisma.organization.create({ data: { name: `E2E Snmp Assign Org ${Date.now()}` } });
    orgId = org.id;

    const ownerMembership = await prisma.organizationMember.create({
      data: { userId: ownerUser.id, organizationId: orgId, role: 'OWNER' },
    });
    const adminMembership = await prisma.organizationMember.create({
      data: { userId: adminUser.id, organizationId: orgId, role: 'ADMIN' },
    });

    // Two sites: ADMIN is scoped to siteA only (via a Team)
    const siteA = await prisma.property.create({
      data: { organizationId: orgId, parentId: null, type: 'SITE', name: `SiteA ${Date.now()}` },
    });
    siteAId = siteA.id;

    const siteB = await prisma.property.create({
      data: { organizationId: orgId, parentId: null, type: 'SITE', name: `SiteB ${Date.now()}` },
    });
    siteBId = siteB.id;

    // Team scoped to siteA only — ADMIN is a member
    const team = await prisma.team.create({
      data: { organizationId: orgId, name: 'Team A', creatorMemberId: ownerMembership.id },
    });
    await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: team.id, propertyId: siteAId } });
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: team.id, memberId: adminMembership.id } });

    // Network chartered to siteA only
    const net = await prisma.network.create({
      data: { organizationId: orgId, name: 'AssignTestNet', userId: ownerUser.id },
    });
    networkId = net.id;
    await prisma.networkProperty.create({
      data: { organizationId: orgId, networkId: net.id, propertyId: siteAId },
    });

    // Device under siteA (ADMIN in scope)
    const deviceA = await prisma.device.create({
      data: {
        organizationId: orgId,
        networkId: net.id,
        propertyId: siteAId,
        name: 'DeviceInScope',
        category: 'SWITCH',
        ipAddress: '10.0.0.1',
      },
    });
    deviceIdInScope = deviceA.id;

    // Device under siteB (ADMIN out of scope)
    const deviceB = await prisma.device.create({
      data: {
        organizationId: orgId,
        networkId: net.id,
        propertyId: siteBId,
        name: 'DeviceOutScope',
        category: 'SWITCH',
        ipAddress: '10.0.0.2',
      },
    });
    deviceIdOutScope = deviceB.id;

    // Network chartered to siteA but with a device footprint in siteB
    // — used for the PERM_004 network-partial-scope test
    const netBSpill = await prisma.network.create({
      data: { organizationId: orgId, name: 'AssignTestNetBSpill', userId: ownerUser.id },
    });
    networkBSpillId = netBSpill.id;
    await prisma.networkProperty.create({
      data: { organizationId: orgId, networkId: netBSpill.id, propertyId: siteAId },
    });
    // Place a device in siteB on this network so the device footprint spills
    await prisma.device.create({
      data: {
        organizationId: orgId,
        networkId: netBSpill.id,
        propertyId: siteBId,
        name: 'DeviceSpill',
        category: 'SWITCH',
        ipAddress: '10.0.1.1',
      },
    });

    // SNMP credential for this org
    const cred = await prisma.snmpCredential.create({
      data: { organizationId: orgId, name: 'test-cred', snmpVersion: 'V2C', communityEnc: 'ENC_BLOB' },
    });
    credentialId = cred.id;
  });

  afterAll(async () => {
    // Detach SNMP assignments before deleting credentials (FK constraint)
    await prisma.network.updateMany({ where: { organizationId: orgId }, data: { snmpCredentialId: null, oidProfileId: null } });
    await prisma.device.updateMany({ where: { organizationId: orgId }, data: { snmpCredentialId: null, oidProfileId: null } });
    // Cascade delete via org
    await prisma.device.deleteMany({ where: { organizationId: orgId } });
    await prisma.networkProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.network.deleteMany({ where: { organizationId: orgId } });
    await prisma.snmpCredential.deleteMany({ where: { organizationId: orgId } });
    await prisma.oidProfile.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, adminEmail] } } });
    await app.close();
  });

  // ─── OWNER: network assignment ────────────────────────────────────────────

  it('OWNER assigns credential to network → 200, snmpCredentialId set', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/snmp/assign')
      .set('Cookie', ownerCookie)
      .send({ targetType: 'network', targetId: networkId, snmpCredentialId: credentialId, oidProfileId: null })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.targetType).toBe('network');
    expect(res.body.data.targetId).toBe(networkId);
    expect(res.body.data.snmpCredentialId).toBe(credentialId);

    // Verify persisted in DB
    const net = await prisma.network.findUnique({ where: { id: networkId } });
    expect(net?.snmpCredentialId).toBe(credentialId);
  });

  // ─── OWNER: device assignment ─────────────────────────────────────────────

  it('OWNER assigns credential to device (in-scope) → 200, snmpCredentialId set', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/snmp/assign')
      .set('Cookie', ownerCookie)
      .send({ targetType: 'device', targetId: deviceIdInScope, snmpCredentialId: credentialId, oidProfileId: null })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.targetType).toBe('device');
    expect(res.body.data.targetId).toBe(deviceIdInScope);
    expect(res.body.data.snmpCredentialId).toBe(credentialId);

    // Verify persisted
    const dev = await prisma.device.findUnique({ where: { id: deviceIdInScope } });
    expect(dev?.snmpCredentialId).toBe(credentialId);
  });

  // ─── ADMIN out-of-scope: device under siteB ──────────────────────────────

  it('ADMIN (scoped siteA only) cannot assign to device under siteB → 403 PERM_001', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/snmp/assign')
      .set('Cookie', adminCookie)
      .send({ targetType: 'device', targetId: deviceIdOutScope, snmpCredentialId: credentialId, oidProfileId: null })
      .expect(403);

    // PERM_001 = OUTSIDE_ASSIGNED_SCOPE (assertCanConfigure)
    expect(res.body.error.code).toBe('PERM_001');
  });

  // ─── ADMIN in-scope: device under siteA → 200 ────────────────────────────

  it('ADMIN (scoped siteA) can assign credential to device under siteA → 200', async () => {
    // First remove any existing assignment from prior OWNER test
    await prisma.device.update({ where: { id: deviceIdInScope }, data: { snmpCredentialId: null } });

    const res = await request(app.getHttpServer())
      .post('/api/v1/snmp/assign')
      .set('Cookie', adminCookie)
      .send({ targetType: 'device', targetId: deviceIdInScope, snmpCredentialId: credentialId, oidProfileId: null })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.snmpCredentialId).toBe(credentialId);
  });

  // ─── Unknown credential → 404 SNMP_001 ───────────────────────────────────

  it('assigning unknown credential → 404 SNMP_001', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/snmp/assign')
      .set('Cookie', ownerCookie)
      .send({ targetType: 'network', targetId: networkId, snmpCredentialId: '00000000-0000-0000-0000-000000000099', oidProfileId: null })
      .expect(404);

    expect(res.body.error.code).toBe('SNMP_001');
  });

  // ─── Unknown target → 404 ─────────────────────────────────────────────────

  it('assigning to unknown network → 404 NETWORK_002', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/snmp/assign')
      .set('Cookie', ownerCookie)
      .send({ targetType: 'network', targetId: '00000000-0000-0000-0000-000000000000', snmpCredentialId: null, oidProfileId: null })
      .expect(404);

    expect(res.body.error.code).toBe('NETWORK_002');
  });

  it('assigning to unknown device → 404 DEVICE_001', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/snmp/assign')
      .set('Cookie', ownerCookie)
      .send({ targetType: 'device', targetId: '00000000-0000-0000-0000-000000000000', snmpCredentialId: null, oidProfileId: null })
      .expect(404);

    expect(res.body.error.code).toBe('DEVICE_001');
  });

  // ─── Missing required fields → 400 ───────────────────────────────────────

  it('body missing snmpCredentialId and oidProfileId → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/snmp/assign')
      .set('Cookie', ownerCookie)
      .send({ targetType: 'network', targetId: networkId })
      .expect(400);
  });

  it('body missing snmpCredentialId only → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/snmp/assign')
      .set('Cookie', ownerCookie)
      .send({ targetType: 'network', targetId: networkId, oidProfileId: null })
      .expect(400);
  });

  it('body missing oidProfileId only → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/snmp/assign')
      .set('Cookie', ownerCookie)
      .send({ targetType: 'network', targetId: networkId, snmpCredentialId: null })
      .expect(400);
  });

  // ─── ADMIN out-of-scope: network with device footprint in siteB → 403 PERM_004 ──

  it('ADMIN (scoped siteA only) cannot assign to network whose device footprint includes siteB → 403 PERM_004', async () => {
    // networkBSpillId is chartered to siteA but has a device in siteB,
    // so assertNetworkFullCoverage fires PERM_004 (NETWORK_PARTIAL_SCOPE)
    const res = await request(app.getHttpServer())
      .post('/api/v1/snmp/assign')
      .set('Cookie', adminCookie)
      .send({ targetType: 'network', targetId: networkBSpillId, snmpCredentialId: credentialId, oidProfileId: null })
      .expect(403);

    // PERM_004 = NETWORK_PARTIAL_SCOPE (assertNetworkFullCoverage)
    expect(res.body.error.code).toBe('PERM_004');
  });
});
