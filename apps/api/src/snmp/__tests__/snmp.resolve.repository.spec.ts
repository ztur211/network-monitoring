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
 *  5. attachTargets decrypts a shared credential once.
 *  6. attachTargets' DB round trips do NOT scale with the size of the device list (no fan-out).
 *  7. Batch resolution agrees with the single-device path device-for-device, and stays org-scoped.
 */
import { Test } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
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
  let crypto: CryptoService;

  // Real DB round trips, counted by a Prisma middleware rather than by spying on a repository
  // method: what must stay bounded is the number of QUERIES a single agent sync fires at the
  // shared connection pool, not the number of TypeScript calls that produced them.
  const queryLog: string[] = [];
  let capturing = false;

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
    crypto = ref.get(CryptoService);
    prisma = ref.get(PrismaService);
    prisma.$use(async (params: Prisma.MiddlewareParams, next) => {
      if (capturing) queryLog.push(`${params.model}.${params.action}`);
      return next(params);
    });
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
    name?: string;
  } = {}) {
    return prisma.device.create({
      data: {
        organizationId: orgId,
        networkId,
        propertyId: siteId,
        // Device names are unique per org (case-insensitive), and Date.now() alone collides
        // between two creates in the same millisecond - callers making several devices in one
        // test pass an explicit name.
        name: overrides.name ?? `Dev-${Date.now()}`,
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

  // ─── 5. attachTargets decrypts a shared credential once, not per device ────
  it('attachTargets fetches+decrypts a shared credential once across many devices', async () => {
    const cred = await svc.createCredential(orgId, {
      name: 'shared-cred',
      snmpVersion: 'V2C',
      community: 'shared-comm',
    });
    await prisma.network.update({ where: { id: networkId }, data: { snmpCredentialId: cred.id } });

    // Three devices all inheriting the same network credential (distinct names to satisfy
    // the per-org case-insensitive name uniqueness under concurrent create).
    const devs = await Promise.all(
      ['10.1.0.1', '10.1.0.2', '10.1.0.3'].map((ipAddress, i) =>
        prisma.device.create({
          data: {
            organizationId: orgId,
            networkId,
            propertyId: siteId,
            name: `Dev-shared-${i}`,
            category: 'SWITCH',
            ipAddress,
          },
        }),
      ),
    );
    const dtos = devs.map((d) => ({ id: d.id, name: d.name, ipAddress: d.ipAddress! }));

    const decryptSpy = jest.spyOn(crypto, 'decrypt');
    const result = await svc.attachTargets(orgId, dtos);

    // All three resolve to the same community...
    expect(result.map((r) => r.snmp?.community)).toEqual(['shared-comm', 'shared-comm', 'shared-comm']);
    // ...but the credential is decrypted ONCE, not once per device.
    expect(decryptSpy).toHaveBeenCalledTimes(1);
    decryptSpy.mockRestore();
  });

  // ─── 6. attachTargets must not fan out one query per device ───────────────

  /**
   * The regression this pins: attachTargets used to resolve every device with its own
   * `device.findFirst`, all fired concurrently from ONE request. The agent polls this on a
   * schedule with the org's ENTIRE fleet, so a 5,000-device org threw 5,000 concurrent queries
   * at the API-wide Prisma pool, exhausted it, and every other in-flight request and socket
   * push started failing on pool timeouts (P2024).
   *
   * The invariant is therefore not "few queries" but "a query count that does not grow with
   * the fleet" - so assert the count is IDENTICAL for a 10-device and a 40-device list.
   */
  it('attachTargets fires the same, bounded number of queries for 40 devices as for 10', async () => {
    const cred = await svc.createCredential(orgId, {
      name: 'fanout-cred',
      snmpVersion: 'V2C',
      community: 'fanout-comm',
    });
    const prof = await svc.createProfile(orgId, {
      name: 'fanout-prof',
      includeInterfaceMetrics: false,
      entries: [{ oid: '1.3.6.1.2.1.1.3.0', metric: 'uptime' }],
    });
    await prisma.network.update({
      where: { id: networkId },
      data: { snmpCredentialId: cred.id, oidProfileId: prof.id },
    });

    const devs = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        prisma.device.create({
          data: {
            organizationId: orgId,
            networkId,
            propertyId: siteId,
            name: `Dev-fanout-${i}`,
            category: 'SWITCH',
            ipAddress: `10.2.${Math.floor(i / 256)}.${i % 256}`,
          },
        }),
      ),
    );
    const dtos = devs.map((d) => ({ id: d.id, name: d.name, ipAddress: d.ipAddress! }));

    const queriesFor = async (list: typeof dtos): Promise<number> => {
      queryLog.length = 0;
      capturing = true;
      try {
        await svc.attachTargets(orgId, list);
      } finally {
        capturing = false;
      }
      return queryLog.length;
    };

    const forTen = await queriesFor(dtos.slice(0, 10));
    const forForty = await queriesFor(dtos);

    // Quadrupling the fleet must not add a single query.
    expect(forForty).toBe(forTen);
    // And the absolute count stays tiny: devices + the credentials + the profiles they reference.
    expect(forForty).toBeLessThanOrEqual(5);
  });

  // ─── 7. Batch resolution must agree with the single-device path, exactly ───

  /**
   * Correctness guard for the batch load: a credential resolved onto the WRONG device is far
   * worse than a slow endpoint, so every device in a mixed batch (inherit / cred override /
   * profile override / both / no credential) must resolve to exactly what the untouched
   * single-device `resolveTarget` returns for it. Also pins the two ways a batched
   * `id: { in: [...] }` load can go wrong: duplicate ids in the list, and an id from another
   * org (which must resolve to nothing, never to the other org's secret).
   */
  it('attachTargets matches resolveTarget per device, and never leaks another org', async () => {
    const netCred = await svc.createCredential(orgId, { name: 'mix-net-cred', snmpVersion: 'V2C', community: 'mix-net-comm' });
    const devCred = await svc.createCredential(orgId, { name: 'mix-dev-cred', snmpVersion: 'V2C', community: 'mix-dev-comm' });
    const netProf = await svc.createProfile(orgId, {
      name: 'mix-net-prof',
      includeInterfaceMetrics: true,
      entries: [{ oid: '1.3.6.1.2.1.1.5.0', metric: 'sysname' }],
    });
    const devProf = await svc.createProfile(orgId, {
      name: 'mix-dev-prof',
      includeInterfaceMetrics: false,
      entries: [{ oid: '1.3.6.1.2.1.1.3.0', metric: 'uptime' }],
    });

    await prisma.network.update({
      where: { id: networkId },
      data: { snmpCredentialId: netCred.id, oidProfileId: netProf.id },
    });

    // Inherit everything / override the cred / override the profile / override both.
    const inherit = await createDevice({ name: 'Dev-mix-inherit', ipAddress: '10.3.0.1' });
    const credOnly = await createDevice({ name: 'Dev-mix-cred', snmpCredentialId: devCred.id, ipAddress: '10.3.0.2' });
    const profOnly = await createDevice({ name: 'Dev-mix-prof', oidProfileId: devProf.id, ipAddress: '10.3.0.3' });
    const both = await createDevice({ name: 'Dev-mix-both', snmpCredentialId: devCred.id, oidProfileId: devProf.id, ipAddress: '10.3.0.4' });

    // A device on a network with no credential at all → no target.
    const bareNet = await prisma.network.create({ data: { organizationId: orgId, name: 'MixBareNet' } });
    const bare = await prisma.device.create({
      data: {
        organizationId: orgId,
        networkId: bareNet.id,
        propertyId: siteId,
        name: 'Dev-mix-bare',
        category: 'SWITCH',
        ipAddress: '10.3.0.5',
      },
    });

    // A fully-credentialled device in a DIFFERENT org - its id must resolve to nothing here.
    const otherOrg = await prisma.organization.create({
      data: { name: `SnmpOther${Date.now()}${Math.floor(performance.now())}` },
    });
    try {
      const otherSite = await prisma.property.create({
        data: { organizationId: otherOrg.id, parentId: null, type: 'SITE', name: 'OtherSite' },
      });
      const otherCred = await svc.createCredential(otherOrg.id, {
        name: 'other-cred',
        snmpVersion: 'V2C',
        community: 'other-org-secret',
      });
      const otherNet = await prisma.network.create({
        data: { organizationId: otherOrg.id, name: 'OtherNet', snmpCredentialId: otherCred.id },
      });
      const foreign = await prisma.device.create({
        data: {
          organizationId: otherOrg.id,
          networkId: otherNet.id,
          propertyId: otherSite.id,
          name: 'Dev-foreign',
          category: 'SWITCH',
          ipAddress: '10.9.0.1',
        },
      });

      const ours = [inherit, credOnly, profOnly, both, bare];
      // credOnly appears TWICE - a batched `in` load de-duplicates ids, and both entries must
      // still come back resolved.
      const dtos = [...ours, credOnly, foreign].map((d) => ({
        id: d.id,
        name: d.name,
        ipAddress: d.ipAddress!,
      }));

      const result = await svc.attachTargets(orgId, dtos);
      expect(result).toHaveLength(dtos.length);
      expect(result.map((r) => r.id)).toEqual(dtos.map((d) => d.id));

      // Every one of our devices must match the single-device path exactly.
      for (const [i, dev] of ours.entries()) {
        const oracle = await svc.resolveTarget(orgId, dev.id);
        if (oracle === null) expect(result[i].snmp).toBeUndefined();
        else expect(result[i].snmp).toEqual(oracle);
      }

      // Spot-check the resolved values themselves, so a bug in BOTH paths cannot pass.
      expect(result[0].snmp).toMatchObject({ community: 'mix-net-comm', interfaceMetrics: true });
      expect(result[0].snmp!.oids).toEqual([{ oid: '1.3.6.1.2.1.1.5.0', metric: 'sysname' }]);
      expect(result[1].snmp).toMatchObject({ community: 'mix-dev-comm', interfaceMetrics: true });
      expect(result[2].snmp).toMatchObject({ community: 'mix-net-comm', interfaceMetrics: false });
      expect(result[2].snmp!.oids).toEqual([{ oid: '1.3.6.1.2.1.1.3.0', metric: 'uptime' }]);
      expect(result[3].snmp).toMatchObject({ community: 'mix-dev-comm', interfaceMetrics: false });
      expect(result[4].snmp).toBeUndefined();

      // The duplicate entry resolves identically to its first occurrence.
      expect(result[5].snmp).toEqual(result[1].snmp);

      // The other org's device gets nothing, and its secret appears nowhere in the payload.
      expect(result[6].snmp).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('other-org-secret');
    } finally {
      await prisma.device.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    }
  });
});
