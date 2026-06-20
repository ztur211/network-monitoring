/**
 * Integration test: SnmpService.resolveTarget + attachTargets (Phase C Tasks 1 & 2).
 *
 * Named *.repository.spec.ts so jest.integration.config.ts picks it up.
 *
 * Assertions:
 *  1. Network-default applies — device inherits network's cred+profile; secrets are decrypted.
 *  2. Device-level override wins over network default (own credentialId / own oidProfileId).
 *  3. No credential on device or network → resolveTarget returns null.
 *  4. attachTargets populates snmp field only for devices that resolve.
 */
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SnmpRepository } from '../snmp.repository';
import { SnmpService } from '../snmp.service';
import { CryptoService, CRYPTO_KEY } from '../../common/crypto/crypto.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { NetworksRepository } from '../../networks/networks.repository';

const TEST_KEY_B64 = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

describe('SnmpService.resolveTarget (integration)', () => {
  let svc: SnmpService;
  let prisma: PrismaService;
  let orgId: string;
  let networkId: string;
  let siteId: string;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      providers: [
        SnmpService,
        SnmpRepository,
        PrismaService,
        CryptoService,
        { provide: CRYPTO_KEY, useValue: Buffer.from(TEST_KEY_B64, 'base64') },
        { provide: PermissionsService, useValue: {} },
        { provide: NetworksRepository, useValue: {} },
      ],
    }).compile();

    svc = ref.get(SnmpService);
    prisma = ref.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Create org, site, and a bare network (no cred/profile yet)
    const org = await prisma.organization.create({
      data: { name: `SnmpResolve${Date.now()}${Math.floor(performance.now())}` },
    });
    orgId = org.id;

    const site = await prisma.property.create({
      data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'TestSite' },
    });
    siteId = site.id;

    const network = await prisma.network.create({
      data: { organizationId: orgId, name: 'TestNet' },
    });
    networkId = network.id;
  });

  afterEach(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
  });

  // Helper: create a device pointing at the shared network + site
  async function createDevice(overrides: {
    snmpCredentialId?: string;
    oidProfileId?: string;
    ipAddress?: string;
  } = {}) {
    return prisma.device.create({
      data: {
        organizationId: orgId,
        networkId,
        propertyId: siteId,
        name: `Dev-${Date.now()}`,
        category: 'SWITCH',
        ipAddress: overrides.ipAddress ?? '10.0.0.1',
        snmpCredentialId: overrides.snmpCredentialId ?? null,
        oidProfileId: overrides.oidProfileId ?? null,
      },
    });
  }

  // ─── 1. Network-default: device inherits network cred + profile ────────────

  it('network default: resolves network cred+profile when device has no overrides', async () => {
    // Create network-level cred + profile
    const netCred = await svc.createCredential(orgId, {
      name: 'net-cred',
      snmpVersion: 'V2C',
      community: 'net-comm',
    });
    const netProf = await svc.createProfile(orgId, {
      name: 'net-prof',
      includeInterfaceMetrics: true,
      entries: [{ oid: '1.3.6.1.2.1.1.5.0', metric: 'sysname' }],
    });

    // Assign cred + profile to network
    await prisma.network.update({
      where: { id: networkId },
      data: { snmpCredentialId: netCred.id, oidProfileId: netProf.id },
    });

    // Device with no overrides
    const device = await createDevice();

    const target = await svc.resolveTarget(orgId, device.id);

    expect(target).not.toBeNull();
    expect(target!.version).toBe('V2C');
    // Secret decrypted correctly
    expect(target!.community).toBe('net-comm');
    // Profile applied
    expect(target!.oids).toHaveLength(1);
    expect(target!.oids[0].oid).toBe('1.3.6.1.2.1.1.5.0');
    expect(target!.interfaceMetrics).toBe(true);
  });

  // ─── 2. Device override wins ───────────────────────────────────────────────

  it('device override: device-level cred wins over network cred', async () => {
    // Network-level cred
    const netCred = await svc.createCredential(orgId, {
      name: 'net-cred-ov',
      snmpVersion: 'V2C',
      community: 'net-comm-ov',
    });
    // Device-level cred (should win)
    const devCred = await svc.createCredential(orgId, {
      name: 'dev-cred',
      snmpVersion: 'V2C',
      community: 'dev-comm',
    });
    const prof = await svc.createProfile(orgId, {
      name: 'shared-prof',
      includeInterfaceMetrics: false,
      entries: [{ oid: '1.3.6.1.2.1.2.2.1.10', metric: 'ifInOctets' }],
    });

    await prisma.network.update({
      where: { id: networkId },
      data: { snmpCredentialId: netCred.id, oidProfileId: prof.id },
    });

    // Device overrides with its own cred
    const device = await createDevice({ snmpCredentialId: devCred.id });

    const target = await svc.resolveTarget(orgId, device.id);

    expect(target).not.toBeNull();
    expect(target!.version).toBe('V2C');
    // Device cred wins — community is 'dev-comm', not 'net-comm-ov'
    expect(target!.community).toBe('dev-comm');
    // OID profile falls back to network level (device has no oidProfileId)
    expect(target!.oids).toHaveLength(1);
    expect(target!.interfaceMetrics).toBe(false);
  });

  // ─── 3. No credential → null ──────────────────────────────────────────────

  it('returns null when neither device nor network has a credential', async () => {
    // Network has no credential
    const device = await createDevice();

    const target = await svc.resolveTarget(orgId, device.id);
    expect(target).toBeNull();
  });

  // ─── 4. attachTargets populates snmp only where resolved ──────────────────

  it('attachTargets populates snmp for resolved devices, omits for null', async () => {
    const cred = await svc.createCredential(orgId, {
      name: 'attach-cred',
      snmpVersion: 'V2C',
      community: 'attach-comm',
    });
    const prof = await svc.createProfile(orgId, {
      name: 'attach-prof',
      includeInterfaceMetrics: false,
      entries: [],
    });

    await prisma.network.update({
      where: { id: networkId },
      data: { snmpCredentialId: cred.id, oidProfileId: prof.id },
    });

    const deviceWithCred = await createDevice({ ipAddress: '10.0.0.2' });

    // Second network with no cred for the no-cred device
    const net2 = await prisma.network.create({
      data: { organizationId: orgId, name: 'NoCredNet' },
    });
    const deviceNoCred = await prisma.device.create({
      data: {
        organizationId: orgId,
        networkId: net2.id,
        propertyId: siteId,
        name: `Dev-NoCred-${Date.now()}`,
        category: 'SWITCH',
        ipAddress: '10.0.0.3',
      },
    });

    const dtos = [
      { id: deviceWithCred.id, name: deviceWithCred.name, ipAddress: deviceWithCred.ipAddress! },
      { id: deviceNoCred.id, name: deviceNoCred.name, ipAddress: deviceNoCred.ipAddress! },
    ];

    const result = await svc.attachTargets(orgId, dtos);

    expect(result).toHaveLength(2);
    // First device: snmp populated
    expect(result[0].snmp).toBeDefined();
    expect(result[0].snmp!.community).toBe('attach-comm');
    // Second device: snmp absent
    expect(result[1].snmp).toBeUndefined();
  });
});
