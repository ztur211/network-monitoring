import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SnmpRepository } from '../snmp.repository';

describe('SnmpRepository (integration)', () => {
  let repo: SnmpRepository; let prisma: PrismaService; let orgId: string;
  beforeAll(async () => { const r = await Test.createTestingModule({ providers: [SnmpRepository, PrismaService] }).compile(); repo = r.get(SnmpRepository); prisma = r.get(PrismaService); await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { orgId = (await prisma.organization.create({ data: { name: `S${Date.now()}` } })).id; });
  afterEach(async () => { await prisma.organization.delete({ where: { id: orgId } }); });

  it('creates a credential (encrypted blobs), a profile with entries, and counts assignments', async () => {
    const cred = await repo.createCredential({ organizationId: orgId, name: 'core-v2c', snmpVersion: 'V2C', securityLevel: null, securityName: null, authProtocol: null, privProtocol: null, communityEnc: 'BLOB', authKeyEnc: null, privKeyEnc: null });
    expect((await repo.findCredential(orgId, cred.id))?.communityEnc).toBe('BLOB');
    const prof = await repo.createProfile({ organizationId: orgId, name: 'std', includeInterfaceMetrics: true }, [{ oid: '1.3.6.1.2.1.1.5.0', metric: 'sysname' }]);
    expect((await repo.findProfile(orgId, prof.id))?.entries).toHaveLength(1);
    await prisma.network.create({ data: { organizationId: orgId, name: 'N', snmpCredentialId: cred.id } });
    expect(await repo.countCredentialAssignments(cred.id)).toBe(1);
  });

  it('countProfileAssignments and deviceWithSnmp resolution', async () => {
    const cred = await repo.createCredential({ organizationId: orgId, name: 'snmp-v2c', snmpVersion: 'V2C', securityLevel: null, securityName: null, authProtocol: null, privProtocol: null, communityEnc: 'BLOB2', authKeyEnc: null, privKeyEnc: null });
    const netCred = await repo.createCredential({ organizationId: orgId, name: 'net-cred', snmpVersion: 'V2C', securityLevel: null, securityName: null, authProtocol: null, privProtocol: null, communityEnc: 'NET_BLOB', authKeyEnc: null, privKeyEnc: null });
    const prof = await repo.createProfile({ organizationId: orgId, name: 'prof2', includeInterfaceMetrics: false }, []);
    const net = await prisma.network.create({ data: { organizationId: orgId, name: 'Net2', oidProfileId: prof.id, snmpCredentialId: netCred.id } });
    // countProfileAssignments: assign profile to network → count 1
    expect(await repo.countProfileAssignments(prof.id)).toBe(1);
    // deviceWithSnmp: device with override cred + network default → returns device override + network fields
    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'S2' } });
    const device = await prisma.device.create({ data: { organizationId: orgId, networkId: net.id, propertyId: site.id, name: 'D1', category: 'SWITCH', ipAddress: '10.0.0.1', snmpCredentialId: cred.id } });
    const resolved = await repo.deviceWithSnmp(orgId, device.id);
    expect(resolved).not.toBeNull();
    expect(resolved!.snmpCredentialId).toBe(cred.id); // device-level override
    expect(resolved!.network?.snmpCredentialId).toBe(netCred.id); // network default
    expect(resolved!.network?.oidProfileId).toBe(prof.id);
  });

  it('devicesWithSnmp loads the same rows as deviceWithSnmp in ONE query, org-scoped and de-duplicated', async () => {
    const netCred = await repo.createCredential({ organizationId: orgId, name: 'batch-cred', snmpVersion: 'V2C', securityLevel: null, securityName: null, authProtocol: null, privProtocol: null, communityEnc: 'BATCH_BLOB', authKeyEnc: null, privKeyEnc: null });
    const net = await prisma.network.create({ data: { organizationId: orgId, name: 'BatchNet', snmpCredentialId: netCred.id } });
    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'BatchSite' } });
    const devices = await Promise.all([0, 1, 2].map((i) => prisma.device.create({ data: { organizationId: orgId, networkId: net.id, propertyId: site.id, name: `Batch-${i}`, category: 'SWITCH', ipAddress: `10.5.0.${i}` } })));

    // Another org's device must never come back, even when its id is asked for by name.
    const otherOrg = await prisma.organization.create({ data: { name: `SOther${Date.now()}${Math.floor(performance.now())}` } });
    try {
      const otherSite = await prisma.property.create({ data: { organizationId: otherOrg.id, parentId: null, type: 'SITE', name: 'OtherSite' } });
      const otherNet = await prisma.network.create({ data: { organizationId: otherOrg.id, name: 'OtherNet' } });
      const otherDev = await prisma.device.create({ data: { organizationId: otherOrg.id, networkId: otherNet.id, propertyId: otherSite.id, name: 'Batch-other', category: 'SWITCH', ipAddress: '10.5.9.9' } });

      // Duplicate ids + an unknown id + a foreign id: the batch must be a superset-safe lookup,
      // never positional, so it returns exactly the 3 in-org rows.
      const rows = await repo.devicesWithSnmp(orgId, [...devices.map((d) => d.id), devices[0].id, otherDev.id, 'no-such-device']);
      expect(rows.map((r) => r.id).sort()).toEqual(devices.map((d) => d.id).sort());
      // Row-for-row identical to the per-device load it replaces.
      for (const d of devices) {
        expect(rows.find((r) => r.id === d.id)).toEqual(await repo.deviceWithSnmp(orgId, d.id));
      }
      expect(rows[0].network?.snmpCredentialId).toBe(netCred.id);
      expect(await repo.devicesWithSnmp(orgId, [])).toEqual([]);
    } finally {
      await prisma.device.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    }
  });
});
