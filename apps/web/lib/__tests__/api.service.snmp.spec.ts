/**
 * Unit tests for the SNMP client methods added to api.service.ts.
 *
 * Strategy: mock the `axios` package so the `api` instance created by
 * api.service.ts uses our controlled mock, then verify each helper calls the
 * right path and unwraps the `{ success, data }` envelope.
 *
 * Component render is NOT tested here — the repo has no RN-component-test
 * infrastructure (no @testing-library/react, no react-test-renderer).
 * This is consistent with the Vitest scope (lib/*, store/*)
 * and mirrors api.service.agents.spec.ts.
 */

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

// Mock axios so the `api` instance created inside api.service.ts uses our fns.
vi.doMock('axios', () => {
  const instance = {
    get: mockGet,
    post: mockPost,
    delete: mockDelete,
    interceptors: { response: { use: vi.fn() } },
  };
  const axiosStatic = {
    create: vi.fn(() => instance),
    isAxiosError: vi.fn(),
    default: undefined as unknown,
  };
  axiosStatic.default = axiosStatic;
  return axiosStatic;
});

const {
  listSnmpCredentials,
  createSnmpCredential,
  deleteSnmpCredential,
  listOidProfiles,
  createOidProfile,
  assignSnmp,
} = await import('../api.service');

/** Minimal SnmpCredentialDto stub for assertion */
const stubCred = {
  id: 'cred-1',
  organizationId: 'org-1',
  name: 'test-cred',
  snmpVersion: 'V2C' as const,
  securityLevel: null,
  securityName: null,
  authProtocol: null,
  privProtocol: null,
  hasCommunity: true,
  hasAuthKey: false,
  hasPrivKey: false,
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

/** Minimal OidProfileDto stub */
const stubProfile = {
  id: 'profile-1',
  organizationId: 'org-1',
  name: 'standard',
  includeInterfaceMetrics: true,
  entries: [],
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('SNMP client methods — endpoint + envelope', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Credentials ──

  describe('listSnmpCredentials()', () => {
    it('calls GET /snmp/credentials and returns the unwrapped data array', async () => {
      mockGet.mockResolvedValueOnce({ data: { success: true, data: [stubCred] } });

      const result = await listSnmpCredentials();

      expect(mockGet).toHaveBeenCalledWith('/snmp/credentials');
      expect(result).toEqual([stubCred]);
    });
  });

  describe('createSnmpCredential()', () => {
    it('calls POST /snmp/credentials with the dto and returns the created credential', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, data: stubCred } });

      const dto = { name: 'test-cred', snmpVersion: 'V2C' as const, community: 's3cr3t' };
      const result = await createSnmpCredential(dto);

      expect(mockPost).toHaveBeenCalledWith('/snmp/credentials', dto);
      expect(result).toEqual(stubCred);
    });
  });

  describe('deleteSnmpCredential()', () => {
    it('calls DELETE /snmp/credentials/:id with the correct id', async () => {
      mockDelete.mockResolvedValueOnce({ data: { success: true, data: null } });

      await deleteSnmpCredential('cred-99');

      expect(mockDelete).toHaveBeenCalledWith('/snmp/credentials/cred-99');
    });

    it('propagates errors so callers can handle them', async () => {
      mockDelete.mockRejectedValueOnce(new Error('conflict'));

      await expect(deleteSnmpCredential('cred-99')).rejects.toThrow('conflict');
    });
  });

  // ── OID Profiles ──

  describe('listOidProfiles()', () => {
    it('calls GET /snmp/oid-profiles and returns the unwrapped data array', async () => {
      mockGet.mockResolvedValueOnce({ data: { success: true, data: [stubProfile] } });

      const result = await listOidProfiles();

      expect(mockGet).toHaveBeenCalledWith('/snmp/oid-profiles');
      expect(result).toEqual([stubProfile]);
    });
  });

  describe('createOidProfile()', () => {
    it('calls POST /snmp/oid-profiles with the dto and returns the created profile', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, data: stubProfile } });

      const dto = { name: 'standard', includeInterfaceMetrics: true };
      const result = await createOidProfile(dto);

      expect(mockPost).toHaveBeenCalledWith('/snmp/oid-profiles', dto);
      expect(result).toEqual(stubProfile);
    });
  });

  // ── Assignment ──

  describe('assignSnmp()', () => {
    it('calls POST /snmp/assign with the correct payload', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, data: null } });

      const payload = {
        targetType: 'network' as const,
        targetId: 'net-42',
        snmpCredentialId: 'cred-1',
        oidProfileId: 'profile-1',
      };
      await assignSnmp(payload);

      expect(mockPost).toHaveBeenCalledWith('/snmp/assign', payload);
    });

    it('supports null credential/profile for explicit unassign', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, data: null } });

      const payload = {
        targetType: 'device' as const,
        targetId: 'dev-7',
        snmpCredentialId: null,
        oidProfileId: null,
      };
      await assignSnmp(payload);

      expect(mockPost).toHaveBeenCalledWith('/snmp/assign', payload);
    });

    it('propagates errors so callers can handle them', async () => {
      mockPost.mockRejectedValueOnce(new Error('forbidden'));

      await expect(
        assignSnmp({ targetType: 'network', targetId: 'net-1', snmpCredentialId: null, oidProfileId: null }),
      ).rejects.toThrow('forbidden');
    });
  });
});
