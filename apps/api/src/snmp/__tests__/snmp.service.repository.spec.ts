/**
 * Integration test for SnmpService (credential + profile management).
 *
 * Named `*.repository.spec.ts` so it runs under jest.integration.config.ts
 * (testRegex: `.*\.repository\.spec\.ts$`). The service needs a real DB to
 * assert encrypted-at-rest storage and the SNMP_003 delete-block — mirrors the
 * agent-token-service.repository.spec.ts precedent.
 *
 * Assertions:
 *  1. createCredential returns a DTO with hasCommunity===true, NO community field.
 *  2. The stored row's communityEnc !== plaintext.
 *  3. crypto.decrypt(communityEnc) === plaintext (encrypted at rest, recoverable).
 *  4. Deleting a credential assigned to a Network throws SNMP_003 (409).
 *  5. Deleting a profile assigned to a Network throws SNMP_003 (409).
 *  6. Deleting an unassigned credential succeeds.
 */
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SnmpRepository } from '../snmp.repository';
import { SnmpService } from '../snmp.service';
import { CryptoService, CRYPTO_KEY } from '../../common/crypto/crypto.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import { PermissionsService } from '../../permissions/permissions.service';
import { NetworksRepository } from '../../networks/networks.repository';

// 32-byte key (base64 of the same value used in CI env)
const TEST_KEY_B64 = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

describe('SnmpService (integration)', () => {
  let svc: SnmpService;
  let repo: SnmpRepository;
  let crypto: CryptoService;
  let prisma: PrismaService;
  let orgId: string;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      providers: [
        SnmpService,
        SnmpRepository,
        PrismaService,
        CryptoService,
        { provide: CRYPTO_KEY, useValue: Buffer.from(TEST_KEY_B64, 'base64') },
        // PermissionsService and NetworksRepository are needed by SnmpService.assign()
        // but not exercised by these integration tests — provide no-op stubs.
        { provide: PermissionsService, useValue: {} },
        { provide: NetworksRepository, useValue: {} },
      ],
    }).compile();

    svc = ref.get(SnmpService);
    repo = ref.get(SnmpRepository);
    crypto = ref.get(CryptoService);
    prisma = ref.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    orgId = (
      await prisma.organization.create({
        data: { name: `SnmpSvc${Date.now()}${Math.floor(performance.now())}` },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
  });

  // ─── Credential create: DTO shape + encrypted-at-rest ─────────────────────

  it('createCredential returns hasCommunity===true and no community field on the DTO', async () => {
    const dto = await svc.createCredential(orgId, {
      name: 'core-v2c',
      snmpVersion: 'V2C',
      community: 'public',
    });

    // Presence boolean set
    expect(dto.hasCommunity).toBe(true);
    expect(dto.hasAuthKey).toBe(false);
    expect(dto.hasPrivKey).toBe(false);

    // Secret NEVER in the DTO — property must be absent or undefined
    expect((dto as unknown as Record<string, unknown>)['community']).toBeUndefined();
    expect((dto as unknown as Record<string, unknown>)['communityEnc']).toBeUndefined();
  });

  it('stored communityEnc !== plaintext AND crypto.decrypt(communityEnc) === plaintext', async () => {
    const plaintext = 'supersecret';
    const dto = await svc.createCredential(orgId, {
      name: 'enc-test',
      snmpVersion: 'V2C',
      community: plaintext,
    });

    // Fetch the raw row directly from DB
    const raw = await prisma.snmpCredential.findFirstOrThrow({ where: { id: dto.id } });
    expect(raw.communityEnc).not.toBeNull();
    expect(raw.communityEnc).not.toBe(plaintext);

    // But it decrypts correctly
    expect(crypto.decrypt(raw.communityEnc!)).toBe(plaintext);
  });

  // ─── SNMP_003: delete blocked when credential is assigned ─────────────────

  it('deleteCredential throws SNMP_003 (409) when credential is assigned to a Network', async () => {
    const cred = await svc.createCredential(orgId, {
      name: 'assigned-cred',
      snmpVersion: 'V2C',
      community: 'public',
    });

    // Assign to a network
    const net = await prisma.network.create({
      data: { organizationId: orgId, name: 'TestNet', snmpCredentialId: cred.id },
    });

    // Should throw SNMP_003
    await expect(svc.deleteCredential(orgId, cred.id)).rejects.toThrow(NodeScopeException);
    await expect(svc.deleteCredential(orgId, cred.id)).rejects.toMatchObject({
      code: 'SNMP_003',
    });

    // Cleanup — detach then delete
    await prisma.network.update({ where: { id: net.id }, data: { snmpCredentialId: null } });
  });

  // ─── SNMP_003: delete blocked when profile is assigned ────────────────────

  it('deleteProfile throws SNMP_003 (409) when profile is assigned to a Network', async () => {
    const prof = await svc.createProfile(orgId, {
      name: 'std-prof',
      includeInterfaceMetrics: false,
      entries: [{ oid: '1.3.6.1.2.1.1.5.0', metric: 'sysname' }],
    });

    const net = await prisma.network.create({
      data: { organizationId: orgId, name: 'TestNet2', oidProfileId: prof.id },
    });

    await expect(svc.deleteProfile(orgId, prof.id)).rejects.toThrow(NodeScopeException);
    await expect(svc.deleteProfile(orgId, prof.id)).rejects.toMatchObject({
      code: 'SNMP_003',
    });

    await prisma.network.update({ where: { id: net.id }, data: { oidProfileId: null } });
  });

  // ─── Happy-path: delete unassigned credential succeeds ────────────────────

  it('deleteCredential succeeds when the credential is not assigned anywhere', async () => {
    const cred = await svc.createCredential(orgId, {
      name: 'unassigned',
      snmpVersion: 'V2C',
      community: 'community',
    });

    await expect(svc.deleteCredential(orgId, cred.id)).resolves.toBeUndefined();

    // Gone from the DB
    const found = await repo.findCredential(orgId, cred.id);
    expect(found).toBeNull();
  });

  // ─── SNMP_001: not-found on get and delete ────────────────────────────────

  it('getCredential throws SNMP_001 (404) for unknown id', async () => {
    await expect(svc.getCredential(orgId, 'no-such-id')).rejects.toMatchObject({
      code: 'SNMP_001',
    });
  });

  it('deleteCredential throws SNMP_001 (404) for unknown id', async () => {
    await expect(svc.deleteCredential(orgId, 'no-such-id')).rejects.toMatchObject({
      code: 'SNMP_001',
    });
  });

  // ─── SNMP_002: not-found on profile get and delete ────────────────────────

  it('getProfile throws SNMP_002 (404) for unknown id', async () => {
    await expect(svc.getProfile(orgId, 'no-such-id')).rejects.toMatchObject({
      code: 'SNMP_002',
    });
  });

  // ─── v3 credential — authKey + privKey encrypted ──────────────────────────

  it('v3 credential stores authKeyEnc + privKeyEnc encrypted, none exposed in DTO', async () => {
    const dto = await svc.createCredential(orgId, {
      name: 'v3-cred',
      snmpVersion: 'V3',
      securityLevel: 'AUTH_PRIV',
      securityName: 'adminuser',
      authProtocol: 'SHA',
      privProtocol: 'AES',
      authKey: 'authsecret',
      privKey: 'privsecret',
    });

    expect(dto.hasAuthKey).toBe(true);
    expect(dto.hasPrivKey).toBe(true);
    expect(dto.hasCommunity).toBe(false);
    expect((dto as unknown as Record<string, unknown>)['authKey']).toBeUndefined();
    expect((dto as unknown as Record<string, unknown>)['privKey']).toBeUndefined();

    const raw = await prisma.snmpCredential.findFirstOrThrow({ where: { id: dto.id } });
    expect(crypto.decrypt(raw.authKeyEnc!)).toBe('authsecret');
    expect(crypto.decrypt(raw.privKeyEnc!)).toBe('privsecret');
  });
});
