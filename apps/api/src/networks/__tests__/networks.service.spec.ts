import { Test, TestingModule } from '@nestjs/testing';
import { NetworksService } from '../networks.service';
import { NetworksRepository } from '../networks.repository';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { AuditService } from '../../audit/audit.service';
import { REALTIME_SERVICE } from '../../realtime/realtime.types';
import { PermissionsService } from '../../permissions/permissions.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import type { OrgMemberContext } from '../../organizations/org-context.types';

const makeNetwork = (overrides = {}) => ({
  id: 'net-1',
  organizationId: 'org-1',
  userId: 'user-1',
  propertyId: null,
  name: 'Home',
  homeAddress: null,
  homeLatitude: null,
  homeLongitude: null,
  homePublicIp: null,
  isp: null,
  downMbps: null,
  upMbps: null,
  version: 1,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

const OWNER: OrgMemberContext = { id: 'member-1', organizationId: 'org-1', role: 'OWNER' };

const mockRepo: jest.Mocked<Pick<
  NetworksRepository,
  | 'findAllByOrgId'
  | 'countByOrgId'
  | 'findByIdAndOrgId'
  | 'listVisible'
  | 'findVisibleByIdAndOrgId'
  | 'charteredPropertyIds'
  | 'findAllByMemberUserId'
  | 'create'
  | 'updateWithVersion'
  | 'deleteByIdAndOrgId'
>> = {
  findAllByOrgId: jest.fn(),
  countByOrgId: jest.fn(),
  findByIdAndOrgId: jest.fn(),
  listVisible: jest.fn(),
  findVisibleByIdAndOrgId: jest.fn(),
  charteredPropertyIds: jest.fn(),
  findAllByMemberUserId: jest.fn(),
  create: jest.fn(),
  updateWithVersion: jest.fn(),
  deleteByIdAndOrgId: jest.fn(),
} as unknown as jest.Mocked<NetworksRepository>;

const mockConflict: jest.Mocked<ConflictResolutionService> = {
  buildUpdatePayload: jest.fn(),
  emitEntityEvent: jest.fn(),
  emitScoped: jest.fn().mockResolvedValue(undefined),
  emitScopedMulti: jest.fn().mockResolvedValue(undefined),
} as unknown as jest.Mocked<ConflictResolutionService>;

const mockRealtime = {
  pushToUser: jest.fn(),
  pushToTier: jest.fn(),
  pushToOrg: jest.fn(),
  getConnectionStatus: jest.fn(),
  recomputeOnHomeForUser: jest.fn(),
};

const mockAudit = {
  recordCreate: jest.fn().mockResolvedValue(undefined),
  recordUpdate: jest.fn().mockResolvedValue(undefined),
  recordDelete: jest.fn().mockResolvedValue(undefined),
};

const mockPermissions = {
  scopeFilter: jest.fn().mockResolvedValue(null), // OWNER → null (unscoped)
  assertNetworkFullCoverage: jest.fn().mockResolvedValue(undefined),
  assertCanConfigure: jest.fn().mockResolvedValue(undefined),
};

describe('NetworksService', () => {
  let service: NetworksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NetworksService,
        { provide: NetworksRepository, useValue: mockRepo },
        { provide: ConflictResolutionService, useValue: mockConflict },
        { provide: REALTIME_SERVICE, useValue: mockRealtime },
        { provide: AuditService, useValue: mockAudit },
        { provide: PermissionsService, useValue: mockPermissions },
      ],
    }).compile();

    service = module.get<NetworksService>(NetworksService);
    jest.clearAllMocks();
    // Re-apply default mocks after clearAllMocks
    mockPermissions.scopeFilter.mockResolvedValue(null);
    mockPermissions.assertNetworkFullCoverage.mockResolvedValue(undefined);
    mockPermissions.assertCanConfigure.mockResolvedValue(undefined);
  });

  describe('listNetworks', () => {
    it('returns NetworkSummary list without homePublicIp scoped to org', async () => {
      mockRepo.listVisible.mockResolvedValue([
        makeNetwork({ homePublicIp: '203.0.113.1' }),
      ]);

      const result = await service.listNetworks(OWNER);
      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('homePublicIp');
      expect(result[0].id).toBe('net-1');
      expect(mockRepo.listVisible).toHaveBeenCalledWith('org-1', null);
    });

    it('returns empty array when org has no networks', async () => {
      mockRepo.listVisible.mockResolvedValue([]);
      const result = await service.listNetworks(OWNER);
      expect(result).toEqual([]);
    });
  });

  describe('createNetwork', () => {
    it('creates network when org has zero existing networks', async () => {
      mockRepo.countByOrgId.mockResolvedValue(0);
      mockRepo.create.mockResolvedValue(makeNetwork());

      const result = await service.createNetwork(OWNER, 'user-1', { name: 'Home' });
      expect(result.id).toBe('net-1');
      expect(result).toHaveProperty('homePublicIp');
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', userId: 'user-1' }),
      );
      expect(mockAudit.recordCreate).toHaveBeenCalledWith(
        'org-1',
        'Network',
        expect.objectContaining({ id: 'net-1' }),
      );
    });

    it('throws NETWORK_001 NETWORK_LIMIT_EXCEEDED when org already has 1 network', async () => {
      mockRepo.countByOrgId.mockResolvedValue(1);

      await expect(service.createNetwork(OWNER, 'user-1', { name: 'B' })).rejects.toThrow(
        NodeScopeException,
      );
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('throws ORG_003 when MEMBER tries to create', async () => {
      const member: OrgMemberContext = { id: 'member-2', organizationId: 'org-1', role: 'MEMBER' };
      mockPermissions.assertNetworkFullCoverage.mockRejectedValue(
        new NodeScopeException('ORG_003', 'FORBIDDEN_ROLE', 403),
      );

      await expect(service.createNetwork(member, 'user-2', { name: 'X' })).rejects.toThrow(
        NodeScopeException,
      );
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('emits v1:network:updated on successful create (OWNER-only, no charters yet)', async () => {
      mockRepo.countByOrgId.mockResolvedValue(0);
      mockRepo.create.mockResolvedValue(makeNetwork());

      await service.createNetwork(OWNER, 'user-1', { name: 'Home' });
      expect(mockConflict.emitScopedMulti).toHaveBeenCalledWith(
        'org-1',
        [],
        'v1:network:updated',
        expect.objectContaining({ network: expect.objectContaining({ id: 'net-1' }) }),
      );
    });
  });

  describe('getNetwork', () => {
    it('returns NetworkDetail including homePublicIp', async () => {
      mockRepo.findVisibleByIdAndOrgId.mockResolvedValue(
        makeNetwork({ homePublicIp: '203.0.113.1' }),
      );

      const result = await service.getNetwork(OWNER, 'net-1');
      expect(result.homePublicIp).toBe('203.0.113.1');
      expect(mockRepo.findVisibleByIdAndOrgId).toHaveBeenCalledWith('net-1', 'org-1', null);
    });

    it('throws NETWORK_002 NETWORK_NOT_FOUND when not found', async () => {
      mockRepo.findVisibleByIdAndOrgId.mockResolvedValue(null);
      await expect(service.getNetwork(OWNER, 'missing')).rejects.toThrow(NodeScopeException);
    });
  });

  describe('updateNetwork', () => {
    it('applies changeset and returns NetworkDetail', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeNetwork());
      mockRepo.charteredPropertyIds.mockResolvedValue([]);
      mockConflict.buildUpdatePayload.mockReturnValue({ name: 'Renamed' });
      mockRepo.updateWithVersion.mockResolvedValue(
        makeNetwork({ name: 'Renamed', version: 2 }),
      );

      const result = await service.updateNetwork(OWNER, 'net-1', {
        baseVersion: 1,
        changes: [{ field: 'name', oldValue: 'Home', newValue: 'Renamed' }],
      });
      expect(result.name).toBe('Renamed');
      expect(result.version).toBe(2);
      expect(mockRepo.updateWithVersion).toHaveBeenCalledWith('net-1', 'org-1', expect.any(Object), 1);
    });

    it('throws NETWORK_002 when target network not found before applying changeset', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);
      await expect(
        service.updateNetwork(OWNER, 'missing', { baseVersion: 1, changes: [] }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('throws SYNC_001 when optimistic-concurrency check fails at write', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeNetwork());
      mockRepo.charteredPropertyIds.mockResolvedValue([]);
      mockConflict.buildUpdatePayload.mockReturnValue({ name: 'X' });
      mockRepo.updateWithVersion.mockResolvedValue(null);

      await expect(
        service.updateNetwork(OWNER, 'net-1', {
          baseVersion: 1,
          changes: [{ field: 'name', oldValue: 'A', newValue: 'X' }],
        }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('throws PERM_004 when ADMIN does not fully cover all chartered sites', async () => {
      const admin: OrgMemberContext = { id: 'member-3', organizationId: 'org-1', role: 'ADMIN' };
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeNetwork());
      mockRepo.charteredPropertyIds.mockResolvedValue(['site-a', 'site-b']);
      mockPermissions.assertNetworkFullCoverage.mockRejectedValue(
        new NodeScopeException('PERM_004', 'NETWORK_PARTIAL_SCOPE', 403),
      );

      await expect(
        service.updateNetwork(admin, 'net-1', {
          baseVersion: 1,
          changes: [{ field: 'name', oldValue: 'Home', newValue: 'Renamed' }],
        }),
      ).rejects.toThrow(NodeScopeException);
      expect(mockRepo.updateWithVersion).not.toHaveBeenCalled();
    });

    it('emits v1:network:updated with the updated dto and changes (scoped to charter sites)', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeNetwork());
      mockRepo.charteredPropertyIds.mockResolvedValue(['site-a']);
      mockConflict.buildUpdatePayload.mockReturnValue({ name: 'Renamed' });
      const updated = makeNetwork({ name: 'Renamed', version: 2 });
      mockRepo.updateWithVersion.mockResolvedValue(updated);

      await service.updateNetwork(OWNER, 'net-1', {
        baseVersion: 1,
        changes: [{ field: 'name', oldValue: 'Home', newValue: 'Renamed' }],
      });

      expect(mockConflict.emitScopedMulti).toHaveBeenCalledWith(
        'org-1',
        ['site-a'],
        'v1:network:updated',
        expect.objectContaining({
          networkId: 'net-1',
          network: expect.objectContaining({ name: 'Renamed', version: 2 }),
        }),
      );
    });

    it('triggers RealtimeService.recomputeOnHomeForUser when homePublicIp is in changes', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeNetwork());
      mockRepo.charteredPropertyIds.mockResolvedValue([]);
      mockConflict.buildUpdatePayload.mockReturnValue({ homePublicIp: '203.0.113.5' });
      mockRepo.updateWithVersion.mockResolvedValue(
        makeNetwork({ homePublicIp: '203.0.113.5', version: 2 }),
      );

      await service.updateNetwork(OWNER, 'net-1', {
        baseVersion: 1,
        changes: [{ field: 'homePublicIp', oldValue: null, newValue: '203.0.113.5' }],
      });

      expect(mockRealtime.recomputeOnHomeForUser).toHaveBeenCalledWith(expect.any(String));
    });

    it('does NOT trigger recomputeOnHomeForUser when only non-IP fields change', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeNetwork());
      mockRepo.charteredPropertyIds.mockResolvedValue([]);
      mockConflict.buildUpdatePayload.mockReturnValue({ name: 'Renamed' });
      mockRepo.updateWithVersion.mockResolvedValue(makeNetwork({ name: 'Renamed', version: 2 }));

      await service.updateNetwork(OWNER, 'net-1', {
        baseVersion: 1,
        changes: [{ field: 'name', oldValue: 'Home', newValue: 'Renamed' }],
      });

      expect(mockRealtime.recomputeOnHomeForUser).not.toHaveBeenCalled();
    });
  });

  describe('deleteNetwork', () => {
    it('deletes the network when found', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeNetwork());
      mockRepo.charteredPropertyIds.mockResolvedValue([]);

      await service.deleteNetwork(OWNER, 'net-1');
      expect(mockRepo.deleteByIdAndOrgId).toHaveBeenCalledWith('net-1', 'org-1');
    });

    it('throws NETWORK_002 when network does not exist', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);
      await expect(service.deleteNetwork(OWNER, 'missing')).rejects.toThrow(NodeScopeException);
      expect(mockRepo.deleteByIdAndOrgId).not.toHaveBeenCalled();
    });

    it('throws PERM_004 when ADMIN does not fully cover chartered sites', async () => {
      const admin: OrgMemberContext = { id: 'member-3', organizationId: 'org-1', role: 'ADMIN' };
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeNetwork());
      mockRepo.charteredPropertyIds.mockResolvedValue(['site-a', 'site-b']);
      mockPermissions.assertNetworkFullCoverage.mockRejectedValue(
        new NodeScopeException('PERM_004', 'NETWORK_PARTIAL_SCOPE', 403),
      );

      await expect(service.deleteNetwork(admin, 'net-1')).rejects.toThrow(NodeScopeException);
      expect(mockRepo.deleteByIdAndOrgId).not.toHaveBeenCalled();
    });
  });

  describe('setHomeIpFromRequest', () => {
    it('updates the network with the request IP and triggers the on-home recompute', async () => {
      const network = makeNetwork({ homePublicIp: null });
      // First call: org-wide lookup for version; second call: inside updateNetwork (org-wide lookup)
      mockRepo.findByIdAndOrgId.mockResolvedValue(network);
      mockRepo.charteredPropertyIds.mockResolvedValue([]);
      mockConflict.buildUpdatePayload.mockReturnValue({ homePublicIp: '203.0.113.42' });
      mockRepo.updateWithVersion.mockResolvedValue(
        makeNetwork({ homePublicIp: '203.0.113.42', version: 2 }),
      );

      const result = await service.setHomeIpFromRequest(OWNER, 'net-1', '203.0.113.42');

      expect(mockRepo.updateWithVersion).toHaveBeenCalledWith(
        'net-1',
        'org-1',
        expect.objectContaining({ homePublicIp: '203.0.113.42' }),
        1,
      );
      expect(mockRealtime.recomputeOnHomeForUser).toHaveBeenCalledWith(expect.any(String));
      expect(result.homePublicIp).toBe('203.0.113.42');
    });

    it('throws NETWORK_002 when the target network does not belong to the org', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);

      await expect(
        service.setHomeIpFromRequest(OWNER, 'missing', '203.0.113.42'),
      ).rejects.toThrow(NodeScopeException);
      expect(mockRepo.updateWithVersion).not.toHaveBeenCalled();
      expect(mockRealtime.recomputeOnHomeForUser).not.toHaveBeenCalled();
    });

    it('emits v1:network:updated through the conflict service (scoped to charter sites)', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeNetwork({ homePublicIp: null }));
      mockRepo.charteredPropertyIds.mockResolvedValue([]);
      mockConflict.buildUpdatePayload.mockReturnValue({ homePublicIp: '203.0.113.42' });
      mockRepo.updateWithVersion.mockResolvedValue(
        makeNetwork({ homePublicIp: '203.0.113.42', version: 2 }),
      );

      await service.setHomeIpFromRequest(OWNER, 'net-1', '203.0.113.42');

      expect(mockConflict.emitScopedMulti).toHaveBeenCalledWith(
        'org-1',
        [],
        'v1:network:updated',
        expect.objectContaining({
          networkId: 'net-1',
          network: expect.objectContaining({ homePublicIp: '203.0.113.42' }),
        }),
      );
    });
  });

  describe('checkOnHome', () => {
    it('returns onHome=false and networkId=null when user has no network in their org', async () => {
      mockRepo.findAllByMemberUserId.mockResolvedValue([]);

      const result = await service.checkOnHome('user-1', '203.0.113.5');

      expect(result).toEqual({ networkId: null, onHome: false });
    });

    it('returns onHome=true when requestIp matches network.homePublicIp', async () => {
      mockRepo.findAllByMemberUserId.mockResolvedValue([
        makeNetwork({ id: 'net-7', homePublicIp: '203.0.113.5' }),
      ]);

      const result = await service.checkOnHome('user-1', '203.0.113.5');

      expect(result).toEqual({ networkId: 'net-7', onHome: true });
    });

    it('returns onHome=false when requestIp differs from network.homePublicIp', async () => {
      mockRepo.findAllByMemberUserId.mockResolvedValue([
        makeNetwork({ id: 'net-7', homePublicIp: '203.0.113.5' }),
      ]);

      const result = await service.checkOnHome('user-1', '198.51.100.9');

      expect(result).toEqual({ networkId: 'net-7', onHome: false });
    });

    it('returns onHome=false when network.homePublicIp is null (not yet confirmed)', async () => {
      mockRepo.findAllByMemberUserId.mockResolvedValue([
        makeNetwork({ id: 'net-7', homePublicIp: null }),
      ]);

      const result = await service.checkOnHome('user-1', '203.0.113.5');

      expect(result).toEqual({ networkId: 'net-7', onHome: false });
    });

    it('returns onHome=false when requestIp is empty even if homePublicIp is set', async () => {
      mockRepo.findAllByMemberUserId.mockResolvedValue([
        makeNetwork({ id: 'net-7', homePublicIp: '203.0.113.5' }),
      ]);

      const result = await service.checkOnHome('user-1', '');

      expect(result).toEqual({ networkId: 'net-7', onHome: false });
    });
  });
});
