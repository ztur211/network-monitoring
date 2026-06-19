import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentTokenService } from '../agent-token.service';
import { CryptoService } from '../../common/crypto/crypto.service';

/**
 * E2E for Spec 9 Phase C Task 3: SNMP targets attached to agent device-sync.
 *
 * GET /v1/monitoring/agent/devices with x-agent-token:
 *   - A device whose network has an SNMP credential → `snmp.community === 'public'` (decrypted)
 *   - A device on a network with NO credential → `snmp` field is undefined
 *
 * Run: npm run test:e2e -- agent-devices-snmp
 */
describe('AgentIngestController devices with SNMP (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agentTokens: AgentTokenService;
  let crypto: CryptoService;

  let orgId: string;
  let assignedDeviceId: string;
  let plainDeviceId: string;
  let agentToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    agentTokens = app.get(AgentTokenService);
    crypto = app.get(CryptoService);

    // Seed: org, site, two networks (one with credential, one without), two devices.
    const org = await prisma.organization.create({
      data: { name: `E2E AgentDevicesSNMP ${Date.now()}` },
    });
    orgId = org.id;

    const site = await prisma.property.create({
      data: {
        organizationId: orgId,
        parentId: null,
        type: 'SITE',
        name: 'Campus',
      },
    });

    // Network with an assigned SNMP credential (community = 'public')
    const snmpNet = await prisma.network.create({
      data: { organizationId: orgId, name: 'SnmpNet' },
    });

    // SNMP credential with encrypted community 'public'
    const snmpCred = await prisma.snmpCredential.create({
      data: {
        organizationId: orgId,
        name: 'public-v2c',
        snmpVersion: 'V2C',
        communityEnc: crypto.encrypt('public'),
      },
    });

    // Assign credential to network
    await prisma.network.update({
      where: { id: snmpNet.id },
      data: { snmpCredentialId: snmpCred.id },
    });

    // Device on the SNMP network — must have an IP to appear in listOrgDevicesWithIp
    const assignedDev = await prisma.device.create({
      data: {
        organizationId: orgId,
        name: 'SW-snmp',
        category: 'SWITCH',
        propertyId: site.id,
        networkId: snmpNet.id,
        ipAddress: '10.1.1.1',
      },
    });
    assignedDeviceId = assignedDev.id;

    // Network with NO SNMP credential
    const plainNet = await prisma.network.create({
      data: { organizationId: orgId, name: 'PlainNet' },
    });

    // Device on the plain network — also has an IP so it appears in the list
    const plainDev = await prisma.device.create({
      data: {
        organizationId: orgId,
        name: 'SW-plain',
        category: 'SWITCH',
        propertyId: site.id,
        networkId: plainNet.id,
        ipAddress: '10.1.1.2',
      },
    });
    plainDeviceId = plainDev.id;

    // Enroll an agent for this org to get a valid token
    const code = await agentTokens.generateEnrollmentCode(orgId, null);
    const enrolled = await agentTokens.enroll(code, {
      name: 'snmp-test-agent',
      platform: 'linux',
      version: '1.0.0',
    });
    agentToken = enrolled.token;
  });

  afterAll(async () => {
    // Detach SNMP assignments before deleting credentials (FK constraint)
    await prisma.network.updateMany({
      where: { organizationId: orgId },
      data: { snmpCredentialId: null, oidProfileId: null },
    });
    await prisma.device.updateMany({
      where: { organizationId: orgId },
      data: { snmpCredentialId: null, oidProfileId: null },
    });
    await prisma.agentEnrollmentCode.deleteMany({ where: { organizationId: orgId } });
    await prisma.agent.deleteMany({ where: { organizationId: orgId } });
    await prisma.device.deleteMany({ where: { organizationId: orgId } });
    await prisma.network.deleteMany({ where: { organizationId: orgId } });
    await prisma.snmpCredential.deleteMany({ where: { organizationId: orgId } });
    await prisma.oidProfile.deleteMany({ where: { organizationId: orgId } });
    await prisma.property.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await app.close();
  });

  describe('GET /v1/monitoring/agent/devices (SNMP attachment)', () => {
    it('returns 200 with snmp.community decrypted for the assigned device, undefined for the plain device', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/monitoring/agent/devices')
        .set('x-agent-token', agentToken)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const ids: string[] = res.body.data.map((d: { id: string }) => d.id);

      // Both IP-addressed devices must appear
      expect(ids).toContain(assignedDeviceId);
      expect(ids).toContain(plainDeviceId);

      // The SNMP-assigned device must have decrypted community === 'public'
      const assigned = res.body.data.find((d: { id: string }) => d.id === assignedDeviceId);
      expect(assigned).toBeDefined();
      expect(assigned.snmp).toBeDefined();
      expect(assigned.snmp.community).toBe('public');
      expect(assigned.snmp.version).toBe('V2C');

      // The plain device must have NO snmp field
      const plain = res.body.data.find((d: { id: string }) => d.id === plainDeviceId);
      expect(plain).toBeDefined();
      expect(plain.snmp).toBeUndefined();
    });

    it('returns 401 with no token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/monitoring/agent/devices')
        .expect(401);
    });
  });
});
