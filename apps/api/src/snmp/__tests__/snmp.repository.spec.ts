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
    const net = await prisma.network.create({ data: { organizationId: orgId, name: 'N', snmpCredentialId: cred.id } });
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
});
