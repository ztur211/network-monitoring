import { Test, TestingModule } from '@nestjs/testing';
import { OrgRole } from '@prisma/client';
import { MapService } from '../map.service';
import { MapRepository } from '../map.repository';
import { PermissionsService } from '../../permissions/permissions.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import type { OrgMemberContext } from '../../organizations/org-context.types';

const mockMapRepo: jest.Mocked<MapRepository> = {
  findDevicesInBbox: jest.fn(),
  findFiberRunsInBbox: jest.fn(),
  findCircuitsInBbox: jest.fn(),
} as unknown as jest.Mocked<MapRepository>;

const mockPermissions: jest.Mocked<Pick<PermissionsService, 'scopeFilter'>> = {
  scopeFilter: jest.fn(),
};

const ownerMember: OrgMemberContext = {
  id: 'member-1',
  organizationId: 'org-1',
  role: 'OWNER' as OrgRole,
};

const makeDevice = () => ({
  id: 'dev-1',
  userId: 'user-1',
  networkId: null,
  organizationId: 'org-1',
  propertyId: null,
  roleCode: null,
  name: 'Router',
  category: 'ROUTER',
  mobility: 'UNKNOWN',
  browserDeviceId: null,
  latitude: 40.0,
  longitude: -74.0,
  floor: null,
  floorLabel: null,
  ipAddress: null,
  macAddress: null,
  notes: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('MapService', () => {
  let service: MapService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MapService,
        { provide: MapRepository, useValue: mockMapRepo },
        { provide: PermissionsService, useValue: mockPermissions },
      ],
    }).compile();

    service = module.get<MapService>(MapService);
    jest.clearAllMocks();
    // Default: OWNER — no scope filter
    mockPermissions.scopeFilter.mockResolvedValue(null);
  });

  describe('getDevicesInBbox', () => {
    it('returns devices in bbox (OWNER — unscoped)', async () => {
      mockMapRepo.findDevicesInBbox.mockResolvedValue([makeDevice() as any]);

      const result = await service.getDevicesInBbox(ownerMember, '-75,39,-73,41');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('dev-1');
      expect(mockMapRepo.findDevicesInBbox).toHaveBeenCalledWith(
        ownerMember.organizationId, expect.any(Object), undefined, null,
      );
    });

    it('passes scopeIds to the repo when member is scoped', async () => {
      const scopedIds = ['prop-a'];
      mockPermissions.scopeFilter.mockResolvedValue({ propertyIdIn: scopedIds });
      mockMapRepo.findDevicesInBbox.mockResolvedValue([]);

      const scopedMember: OrgMemberContext = { id: 'member-2', organizationId: 'org-1', role: 'MEMBER' as OrgRole };
      await service.getDevicesInBbox(scopedMember, '-75,39,-73,41');
      expect(mockMapRepo.findDevicesInBbox).toHaveBeenCalledWith(
        'org-1', expect.any(Object), undefined, scopedIds,
      );
    });

    it('throws GEN_001 for invalid bbox format', async () => {
      await expect(service.getDevicesInBbox(ownerMember, 'invalid')).rejects.toThrow(NodeScopeException);
    });

    it('throws GEN_001 when bbox has invalid coordinate range', async () => {
      await expect(service.getDevicesInBbox(ownerMember, '-200,39,-73,41')).rejects.toThrow(NodeScopeException);
    });
  });

  describe('getFiberRunsInBbox', () => {
    it('returns fiber runs in bbox', async () => {
      mockMapRepo.findFiberRunsInBbox.mockResolvedValue([]);

      const result = await service.getFiberRunsInBbox(ownerMember, '-75,39,-73,41');
      expect(result.items).toHaveLength(0);
      expect(mockMapRepo.findFiberRunsInBbox).toHaveBeenCalledWith(
        ownerMember.organizationId, expect.any(Object), null,
      );
    });
  });

  describe('getCircuitsInBbox', () => {
    it('returns circuits in bbox', async () => {
      mockMapRepo.findCircuitsInBbox.mockResolvedValue([]);

      const result = await service.getCircuitsInBbox(ownerMember, '-75,39,-73,41');
      expect(result.items).toHaveLength(0);
      expect(mockMapRepo.findCircuitsInBbox).toHaveBeenCalledWith(
        ownerMember.organizationId, expect.any(Object), null,
      );
    });
  });
});
