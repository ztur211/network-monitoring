import { Test, TestingModule } from '@nestjs/testing';
import { DevicesService } from '../devices.service';
import { DevicesRepository } from '../devices.repository';
import { OrganizationsRepository } from '../../organizations/organizations.repository';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { AuditService } from '../../audit/audit.service';
import { ContainmentService } from '../../properties/containment.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { PropertiesService } from '../../properties/properties.service';
import { SpatialRepository } from '../../spatial/spatial.repository';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import { DeviceCategory, DeviceMobility } from '@prisma/client';

const member = { id: 'm-owner', organizationId: 'org-1', role: 'OWNER' as const };
const missingOrgMember = { id: 'm', organizationId: 'missing-org', role: 'OWNER' as const };

const makeDevice = (overrides = {}) => ({
  id: 'dev-1',
  organizationId: 'org-1',
  userId: 'user-1',
  networkId: 'net-1',
  propertyId: 'prop-1',
  roleCode: null,
  name: 'Router',
  category: DeviceCategory.ROUTER,
  mobility: DeviceMobility.UNKNOWN,
  ifcGlobalId: null,
  latitude: null,
  longitude: null,
  floor: null,
  floorLabel: null,
  x: null,
  y: null,
  z: null,
  ipAddress: null,
  macAddress: null,
  notes: null,
  version: 1,
  snmpCredentialId: null,
  oidProfileId: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

const makeOrg = (overrides = {}) => ({
  id: 'org-1',
  name: 'Test Org',
  namingPattern: null,
  namingMaxLen: null,
  namingTemplate: null,
  version: 1,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

const mockRepo: jest.Mocked<DevicesRepository> = {
  findAllByOrgId: jest.fn(),
  countByOrgId: jest.fn(),
  findByIdAndOrgId: jest.fn(),
  create: jest.fn(),
  updateWithVersion: jest.fn(),
  deleteByIdAndOrgId: jest.fn(),
  existsByNameCaseInsensitive: jest.fn(),
} as unknown as jest.Mocked<DevicesRepository>;

const mockOrgsRepo: jest.Mocked<OrganizationsRepository> = {
  findOrganizationById: jest.fn(),
} as unknown as jest.Mocked<OrganizationsRepository>;

const mockConflict: jest.Mocked<ConflictResolutionService> = {
  buildUpdatePayload: jest.fn(),
  emitEntityEvent: jest.fn(),
  emitScoped: jest.fn().mockResolvedValue(undefined),
  emitScopedMulti: jest.fn().mockResolvedValue(undefined),
} as unknown as jest.Mocked<ConflictResolutionService>;

const mockAudit = {
  recordCreate: jest.fn().mockResolvedValue(undefined),
  recordUpdate: jest.fn().mockResolvedValue(undefined),
  recordDelete: jest.fn().mockResolvedValue(undefined),
};

const mockContainment: jest.Mocked<ContainmentService> = {
  assertDevicePlacement: jest.fn().mockResolvedValue(undefined),
  assertReparentKeepsContainment: jest.fn().mockResolvedValue(undefined),
  assertCharterRemovable: jest.fn().mockResolvedValue(undefined),
} as unknown as jest.Mocked<ContainmentService>;

const mockPermissions = {
  scopeFilter: jest.fn().mockResolvedValue(null),
  assertCanConfigure: jest.fn().mockResolvedValue(undefined),
};

const mockProperties = {
  subtreePropertyIds: jest.fn().mockResolvedValue([]),
};

const mockSpatial: jest.Mocked<Pick<SpatialRepository, 'resolveGoverningBuildingId'>> = {
  resolveGoverningBuildingId: jest.fn().mockResolvedValue(null),
};

describe('DevicesService', () => {
  let service: DevicesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevicesService,
        { provide: DevicesRepository, useValue: mockRepo },
        { provide: OrganizationsRepository, useValue: mockOrgsRepo },
        { provide: ConflictResolutionService, useValue: mockConflict },
        { provide: AuditService, useValue: mockAudit },
        { provide: ContainmentService, useValue: mockContainment },
        { provide: PermissionsService, useValue: mockPermissions },
        { provide: PropertiesService, useValue: mockProperties },
        { provide: SpatialRepository, useValue: mockSpatial },
      ],
    }).compile();

    service = module.get<DevicesService>(DevicesService);
    jest.clearAllMocks();
    mockContainment.assertDevicePlacement.mockResolvedValue(undefined);
    mockPermissions.scopeFilter.mockResolvedValue(null);
    mockPermissions.assertCanConfigure.mockResolvedValue(undefined);
    mockProperties.subtreePropertyIds.mockResolvedValue([]);
    mockConflict.emitScoped.mockResolvedValue(undefined);
    mockConflict.emitScopedMulti.mockResolvedValue(undefined);
    // Default: same building for both old + new property → coords preserved (safe default for non-move tests)
    mockSpatial.resolveGoverningBuildingId.mockResolvedValue('bldg-1');
  });

  describe('listDevices', () => {
    it('returns items and total scoped to the org', async () => {
      mockRepo.findAllByOrgId.mockResolvedValue([makeDevice()]);
      mockRepo.countByOrgId.mockResolvedValue(1);

      const result = await service.listDevices(member);
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('dev-1');
      expect(mockRepo.findAllByOrgId).toHaveBeenCalledWith('org-1', null);
      expect(mockRepo.countByOrgId).toHaveBeenCalledWith('org-1', null);
    });
  });

  describe('listDevicesForBuilding', () => {
    const buildingId = 'bld-1';

    it('OWNER: lists the full building subtree, no scope filter', async () => {
      mockProperties.subtreePropertyIds.mockResolvedValue(['bld-1', 'floor-1', 'floor-2']);
      mockPermissions.scopeFilter.mockResolvedValue(null);
      mockRepo.findAllByOrgId.mockResolvedValue([makeDevice({ id: 'd1', propertyId: 'floor-1' })]);

      const out = await service.listDevicesForBuilding(member, buildingId);

      expect(mockProperties.subtreePropertyIds).toHaveBeenCalledWith('org-1', 'bld-1');
      expect(mockRepo.findAllByOrgId).toHaveBeenCalledWith('org-1', {
        propertyIdIn: ['bld-1', 'floor-1', 'floor-2'],
      });
      expect(out.map((d) => d.id)).toEqual(['d1']);
    });

    it('ADMIN: intersects the building subtree with the F3 read-scope', async () => {
      const admin = { id: 'm-admin', organizationId: 'org-1', role: 'ADMIN' as const };
      mockProperties.subtreePropertyIds.mockResolvedValue(['bld-1', 'floor-1', 'floor-2']);
      mockPermissions.scopeFilter.mockResolvedValue({ propertyIdIn: ['floor-1', 'elsewhere'] });
      mockRepo.findAllByOrgId.mockResolvedValue([]);

      await service.listDevicesForBuilding(admin, buildingId);

      expect(mockRepo.findAllByOrgId).toHaveBeenCalledWith('org-1', { propertyIdIn: ['floor-1'] });
    });

    it('returns [] without querying when scope excludes the whole subtree', async () => {
      const admin = { id: 'm-admin', organizationId: 'org-1', role: 'ADMIN' as const };
      mockProperties.subtreePropertyIds.mockResolvedValue(['bld-1', 'floor-1']);
      mockPermissions.scopeFilter.mockResolvedValue({ propertyIdIn: ['unrelated'] });

      const out = await service.listDevicesForBuilding(admin, buildingId);

      expect(out).toEqual([]);
      expect(mockRepo.findAllByOrgId).not.toHaveBeenCalled();
    });
  });

  describe('createDevice', () => {
    it('creates and returns DeviceDto when org exists, name available, and placement valid', async () => {
      mockOrgsRepo.findOrganizationById.mockResolvedValue(makeOrg());
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(makeDevice());

      const result = await service.createDevice(member, 'user-1', {
        name: 'Router',
        category: DeviceCategory.ROUTER,
        networkId: 'net-1',
        propertyId: 'prop-1',
      });

      expect(result.id).toBe('dev-1');
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', userId: 'user-1' }),
      );
      expect(mockContainment.assertDevicePlacement).toHaveBeenCalledWith('org-1', 'net-1', 'prop-1');
      expect(mockAudit.recordCreate).toHaveBeenCalledWith(
        'org-1',
        'Device',
        expect.objectContaining({ id: 'dev-1' }),
      );
    });

    it('throws ORG_001 ORGANIZATION_NOT_FOUND when org does not exist', async () => {
      mockOrgsRepo.findOrganizationById.mockResolvedValue(null);

      await expect(
        service.createDevice(missingOrgMember, 'user-1', { name: 'Router', category: DeviceCategory.ROUTER, networkId: 'net-1', propertyId: 'prop-1' }),
      ).rejects.toThrow(NodeScopeException);

      await expect(
        service.createDevice(missingOrgMember, 'user-1', { name: 'Router', category: DeviceCategory.ROUTER, networkId: 'net-1', propertyId: 'prop-1' }),
      ).rejects.toMatchObject({ code: 'ORG_001' });
    });

    it('throws ORG_005 DEVICE_NAME_TAKEN when device name is already taken in org', async () => {
      mockOrgsRepo.findOrganizationById.mockResolvedValue(makeOrg());
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(true);

      await expect(
        service.createDevice(member, 'user-1', { name: 'Router', category: DeviceCategory.ROUTER, networkId: 'net-1', propertyId: 'prop-1' }),
      ).rejects.toThrow(NodeScopeException);

      await expect(
        service.createDevice(member, 'user-1', { name: 'Router', category: DeviceCategory.ROUTER, networkId: 'net-1', propertyId: 'prop-1' }),
      ).rejects.toMatchObject({ code: 'ORG_005' });
    });

    it('throws ORG_006 NAMING_POLICY_VIOLATION when name violates namingPattern', async () => {
      mockOrgsRepo.findOrganizationById.mockResolvedValue(
        makeOrg({ namingPattern: '^[a-z]+-[0-9]{2}$' }),
      );
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);

      await expect(
        service.createDevice(member, 'user-1', { name: 'BadName', category: DeviceCategory.ROUTER, networkId: 'net-1', propertyId: 'prop-1' }),
      ).rejects.toThrow(NodeScopeException);

      await expect(
        service.createDevice(member, 'user-1', { name: 'BadName', category: DeviceCategory.ROUTER, networkId: 'net-1', propertyId: 'prop-1' }),
      ).rejects.toMatchObject({ code: 'ORG_006' });
    });

    it('succeeds when name matches namingPattern', async () => {
      mockOrgsRepo.findOrganizationById.mockResolvedValue(
        makeOrg({ namingPattern: '^[a-z]+-[0-9]{2}$' }),
      );
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(makeDevice({ name: 'router-01' }));

      const result = await service.createDevice(member, 'user-1', {
        name: 'router-01',
        category: DeviceCategory.ROUTER,
        networkId: 'net-1',
        propertyId: 'prop-1',
      });

      expect(result.name).toBe('router-01');
    });

    it('throws ORG_006 when name exceeds namingMaxLen', async () => {
      mockOrgsRepo.findOrganizationById.mockResolvedValue(makeOrg({ namingMaxLen: 5 }));
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);

      await expect(
        service.createDevice(member, 'user-1', { name: 'TooLongName', category: DeviceCategory.ROUTER, networkId: 'net-1', propertyId: 'prop-1' }),
      ).rejects.toMatchObject({ code: 'ORG_006' });
    });

    it('throws PROP_007 when device placement is outside all chartered sites', async () => {
      mockOrgsRepo.findOrganizationById.mockResolvedValue(makeOrg());
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockContainment.assertDevicePlacement.mockRejectedValueOnce(
        Object.assign(new Error('PROP_007'), { code: 'PROP_007' }),
      );

      await expect(
        service.createDevice(member, 'user-1', { name: 'Router', category: DeviceCategory.ROUTER, networkId: 'net-1', propertyId: 'other-prop' }),
      ).rejects.toMatchObject({ code: 'PROP_007' });
    });

    it('does not call TiersService (tier limit removed)', async () => {
      mockOrgsRepo.findOrganizationById.mockResolvedValue(makeOrg());
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(makeDevice());

      await service.createDevice(member, 'user-1', { name: 'Router', category: DeviceCategory.ROUTER, networkId: 'net-1', propertyId: 'prop-1' });

      // TiersService is not injected — no mock to check. Absence of DEVICE_002 error
      // and no countByOrgId call for limit checks confirms tiers are bypassed.
      expect(mockRepo.countByOrgId).not.toHaveBeenCalled();
    });
  });

  describe('getDevice', () => {
    it('returns DeviceDto for existing device in org', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeDevice());

      const result = await service.getDevice(member, 'dev-1');
      expect(result.id).toBe('dev-1');
      expect(mockRepo.findByIdAndOrgId).toHaveBeenCalledWith('dev-1', 'org-1', null);
    });

    it('throws DEVICE_001 when device not found in org', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);

      await expect(service.getDevice(member, 'missing')).rejects.toThrow(NodeScopeException);
      await expect(service.getDevice(member, 'missing')).rejects.toMatchObject({ code: 'DEVICE_001' });
    });
  });

  describe('updateDevice', () => {
    it('applies changeset and returns updated DeviceDto', async () => {
      const device = makeDevice();
      const updated = makeDevice({ name: 'Updated Router', version: 2 });
      mockRepo.findByIdAndOrgId.mockResolvedValue(device);
      mockConflict.buildUpdatePayload.mockReturnValue({ name: 'Updated Router' });
      mockOrgsRepo.findOrganizationById.mockResolvedValue(makeOrg());
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockRepo.updateWithVersion.mockResolvedValue(updated);

      const result = await service.updateDevice(member, 'dev-1', {
        baseVersion: 1,
        changes: [{ field: 'name', oldValue: 'Router', newValue: 'Updated Router' }],
      });

      expect(result.name).toBe('Updated Router');
      expect(result.version).toBe(2);
      expect(mockConflict.emitScoped).toHaveBeenCalledWith(
        'org-1',
        expect.any(String),
        'v1:device:updated',
        expect.objectContaining({ deviceId: 'dev-1' }),
      );
    });

    it('throws ORG_005 DEVICE_NAME_TAKEN on name collision during update', async () => {
      const device = makeDevice();
      mockRepo.findByIdAndOrgId.mockResolvedValue(device);
      mockConflict.buildUpdatePayload.mockReturnValue({ name: 'Taken Name' });
      mockOrgsRepo.findOrganizationById.mockResolvedValue(makeOrg());
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(true);

      await expect(
        service.updateDevice(member, 'dev-1', {
          baseVersion: 1,
          changes: [{ field: 'name', oldValue: 'Router', newValue: 'Taken Name' }],
        }),
      ).rejects.toMatchObject({ code: 'ORG_005' });
    });

    it('throws ORG_006 NAMING_POLICY_VIOLATION on name violating pattern during update', async () => {
      const device = makeDevice();
      mockRepo.findByIdAndOrgId.mockResolvedValue(device);
      mockConflict.buildUpdatePayload.mockReturnValue({ name: 'BadName' });
      mockOrgsRepo.findOrganizationById.mockResolvedValue(
        makeOrg({ namingPattern: '^[a-z]+-[0-9]{2}$' }),
      );
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);

      await expect(
        service.updateDevice(member, 'dev-1', {
          baseVersion: 1,
          changes: [{ field: 'name', oldValue: 'Router', newValue: 'BadName' }],
        }),
      ).rejects.toMatchObject({ code: 'ORG_006' });
    });

    it('throws SYNC_001 when concurrent update causes version conflict at DB level', async () => {
      const device = makeDevice();
      mockRepo.findByIdAndOrgId.mockResolvedValue(device);
      mockConflict.buildUpdatePayload.mockReturnValue({ notes: 'new notes' });
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockRepo.updateWithVersion.mockResolvedValue(null);

      await expect(
        service.updateDevice(member, 'dev-1', {
          baseVersion: 1,
          changes: [{ field: 'notes', oldValue: null, newValue: 'new notes' }],
        }),
      ).rejects.toMatchObject({ code: 'SYNC_001' });
    });

    it('throws DEVICE_001 when device not found in org', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);

      await expect(
        service.updateDevice(member, 'missing', {
          baseVersion: 1,
          changes: [{ field: 'notes', oldValue: null, newValue: 'x' }],
        }),
      ).rejects.toMatchObject({ code: 'DEVICE_001' });
    });

    it('calls assertDevicePlacement when propertyId changes in patch', async () => {
      const device = makeDevice();
      const updated = makeDevice({ propertyId: 'new-prop', version: 2 });
      mockRepo.findByIdAndOrgId.mockResolvedValue(device);
      mockConflict.buildUpdatePayload.mockReturnValue({ propertyId: 'new-prop' });
      mockRepo.updateWithVersion.mockResolvedValue(updated);

      await service.updateDevice(member, 'dev-1', {
        baseVersion: 1,
        changes: [{ field: 'propertyId', oldValue: 'prop-1', newValue: 'new-prop' }],
      });

      expect(mockContainment.assertDevicePlacement).toHaveBeenCalledWith('org-1', 'net-1', 'new-prop');
    });

    it('clears x/y/z when a move crosses a building boundary', async () => {
      // Device starts on prop-1 which resolves to building-A; we move it to prop-2
      // which resolves to building-B — the clear branch must fire.
      const device = makeDevice({ x: 1.5, y: 2, z: 3, propertyId: 'prop-1' });
      const updated = makeDevice({ propertyId: 'prop-2', x: null, y: null, z: null, version: 2 });
      mockRepo.findByIdAndOrgId.mockResolvedValue(device);
      mockConflict.buildUpdatePayload.mockReturnValue({ propertyId: 'prop-2' });
      mockRepo.updateWithVersion.mockResolvedValue(updated);
      // Key the spatial mock on the propertyId so it's robust against call order
      mockSpatial.resolveGoverningBuildingId.mockImplementation(
        async (_org: string, propertyId: string) =>
          propertyId === 'prop-1' ? 'building-A' : 'building-B',
      );

      await service.updateDevice(member, 'dev-1', {
        baseVersion: 1,
        changes: [{ field: 'propertyId', oldValue: 'prop-1', newValue: 'prop-2' }],
      });

      // The payload passed to updateWithVersion must have coords nulled out
      const payload = mockRepo.updateWithVersion.mock.calls[0][2];
      expect(payload.x).toBeNull();
      expect(payload.y).toBeNull();
      expect(payload.z).toBeNull();
    });
  });

  describe('deleteDevice', () => {
    it('deletes device and emits WS event', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeDevice());
      mockRepo.deleteByIdAndOrgId.mockResolvedValue(undefined);

      await service.deleteDevice(member, 'dev-1');

      expect(mockRepo.deleteByIdAndOrgId).toHaveBeenCalledWith('dev-1', 'org-1');
      expect(mockConflict.emitScoped).toHaveBeenCalledWith(
        'org-1',
        expect.any(String),
        'v1:device:deleted',
        expect.objectContaining({ deviceId: 'dev-1' }),
      );
    });

    it('throws DEVICE_001 when device not found', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);

      await expect(service.deleteDevice(member, 'missing')).rejects.toMatchObject({
        code: 'DEVICE_001',
      });
    });
  });
});
