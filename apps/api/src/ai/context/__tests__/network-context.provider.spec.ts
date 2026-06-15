import { Test } from '@nestjs/testing';
import { NetworkContextProvider } from '../network-context.provider';
import { NetworkContextRepository } from '../network-context.repository';
import { PermissionsRepository } from '../../../permissions/permissions.repository';
import { PermissionsService } from '../../../permissions/permissions.service';

const emptyEntities = { devices: [], connections: [], fiberRuns: [], circuits: [] };

const ownerMember = { id: 'mem-owner', organizationId: 'org-1', role: 'OWNER' as const };
const adminMember = { id: 'mem-admin', organizationId: 'org-1', role: 'ADMIN' as const };

const mockRepo = {
  getNetworkEntities: jest.fn().mockResolvedValue(emptyEntities),
};

const mockPermRepo = {
  findMember: jest.fn(),
};

const mockPermService = {
  scopeFilter: jest.fn(),
};

describe('NetworkContextProvider', () => {
  let provider: NetworkContextProvider;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        NetworkContextProvider,
        { provide: NetworkContextRepository, useValue: mockRepo },
        { provide: PermissionsRepository, useValue: mockPermRepo },
        { provide: PermissionsService, useValue: mockPermService },
      ],
    }).compile();

    provider = module.get(NetworkContextProvider);
    jest.clearAllMocks();
    mockRepo.getNetworkEntities.mockResolvedValue(emptyEntities);
  });

  describe('getContext — OWNER (scopeFilter returns null)', () => {
    it('passes scopeIds=null so the repository applies no filter', async () => {
      mockPermRepo.findMember.mockResolvedValue(ownerMember);
      mockPermService.scopeFilter.mockResolvedValue(null);

      await provider.getContext('org-1', 'user-owner');

      expect(mockPermRepo.findMember).toHaveBeenCalledWith('org-1', 'user-owner');
      expect(mockPermService.scopeFilter).toHaveBeenCalledWith(ownerMember);
      expect(mockRepo.getNetworkEntities).toHaveBeenCalledWith('org-1', null);
    });
  });

  describe('getContext — scoped ADMIN (scopeFilter returns propertyIdIn)', () => {
    it('passes the scoped propertyIdIn list to the repository', async () => {
      mockPermRepo.findMember.mockResolvedValue(adminMember);
      mockPermService.scopeFilter.mockResolvedValue({ propertyIdIn: ['site-A', 'site-B'] });

      await provider.getContext('org-1', 'user-admin');

      expect(mockRepo.getNetworkEntities).toHaveBeenCalledWith('org-1', ['site-A', 'site-B']);
    });
  });

  describe('getContext — non-member (findMember returns null)', () => {
    it('passes an empty scopeIds list so the member sees no entities', async () => {
      mockPermRepo.findMember.mockResolvedValue(null);

      await provider.getContext('org-1', 'user-stranger');

      // scopeFilter is never called for non-members; we fall straight to empty list
      expect(mockPermService.scopeFilter).not.toHaveBeenCalled();
      expect(mockRepo.getNetworkEntities).toHaveBeenCalledWith('org-1', []);
    });
  });

  describe('getContext — output assembly', () => {
    it('returns "No devices documented yet" when entity lists are empty', async () => {
      mockPermRepo.findMember.mockResolvedValue(ownerMember);
      mockPermService.scopeFilter.mockResolvedValue(null);

      const result = await provider.getContext('org-1', 'user-owner');

      expect(result).toContain('No devices documented yet');
    });

    it('includes device names and connection info in the returned string', async () => {
      mockPermRepo.findMember.mockResolvedValue(ownerMember);
      mockPermService.scopeFilter.mockResolvedValue(null);
      mockRepo.getNetworkEntities.mockResolvedValue({
        devices: [{ name: 'Router', category: 'ROUTER', ipAddress: '10.0.0.1', floor: null, floorLabel: null, notes: null }],
        connections: [{ connectionType: 'ETHERNET', notes: null, sourceDevice: { name: 'Router' }, targetDevice: { name: 'Switch' } }],
        fiberRuns: [],
        circuits: [],
      });

      const result = await provider.getContext('org-1', 'user-owner');

      expect(result).toContain('Router');
      expect(result).toContain('10.0.0.1');
      expect(result).toContain('ETHERNET');
    });
  });
});
