import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { DevicesService } from '../devices.service';
import { DevicesRepository } from '../devices.repository';
import { OrganizationsRepository } from '../../organizations/organizations.repository';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import { DeviceCategory, DeviceMobility } from '@prisma/client';

const makeDevice = (overrides = {}) => ({
  id: 'dev-1',
  organizationId: 'org-1',
  userId: 'user-1',
  networkId: null,
  name: 'Router',
  category: DeviceCategory.ROUTER,
  mobility: DeviceMobility.UNKNOWN,
  browserDeviceId: null,
  latitude: null,
  longitude: null,
  floor: null,
  floorLabel: null,
  ipAddress: null,
  macAddress: null,
  notes: null,
  version: 1,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

const makeOrg = (overrides = {}) => ({
  id: 'org-1',
  name: 'Test Org',
  namingPattern: null,
  namingMaxLen: null,
  version: 1,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

const mockRepo: jest.Mocked<DevicesRepository> = {
  findAllByOrgId: jest.fn(),
  countByOrgId: jest.fn(),
  findByIdAndOrgId: jest.fn(),
  findByOrgIdAndBrowserDeviceId: jest.fn(),
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
} as unknown as jest.Mocked<ConflictResolutionService>;

describe('DevicesService', () => {
  let service: DevicesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevicesService,
        { provide: DevicesRepository, useValue: mockRepo },
        { provide: OrganizationsRepository, useValue: mockOrgsRepo },
        { provide: ConflictResolutionService, useValue: mockConflict },
      ],
    }).compile();

    service = module.get<DevicesService>(DevicesService);
    jest.clearAllMocks();
  });

  describe('listDevices', () => {
    it('returns items and total scoped to the org', async () => {
      mockRepo.findAllByOrgId.mockResolvedValue([makeDevice()]);
      mockRepo.countByOrgId.mockResolvedValue(1);

      const result = await service.listDevices('org-1');
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('dev-1');
      expect(mockRepo.findAllByOrgId).toHaveBeenCalledWith('org-1');
      expect(mockRepo.countByOrgId).toHaveBeenCalledWith('org-1');
    });
  });

  describe('createDevice', () => {
    it('creates and returns DeviceDto when org exists and name is available', async () => {
      mockOrgsRepo.findOrganizationById.mockResolvedValue(makeOrg());
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(makeDevice());

      const result = await service.createDevice('org-1', 'user-1', {
        name: 'Router',
        category: DeviceCategory.ROUTER,
      });

      expect(result.id).toBe('dev-1');
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', userId: 'user-1' }),
      );
    });

    it('throws ORG_001 ORGANIZATION_NOT_FOUND when org does not exist', async () => {
      mockOrgsRepo.findOrganizationById.mockResolvedValue(null);

      await expect(
        service.createDevice('missing-org', 'user-1', { name: 'Router', category: DeviceCategory.ROUTER }),
      ).rejects.toThrow(NodeScopeException);

      await expect(
        service.createDevice('missing-org', 'user-1', { name: 'Router', category: DeviceCategory.ROUTER }),
      ).rejects.toMatchObject({ code: 'ORG_001' });
    });

    it('throws ORG_005 DEVICE_NAME_TAKEN when device name is already taken in org', async () => {
      mockOrgsRepo.findOrganizationById.mockResolvedValue(makeOrg());
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(true);

      await expect(
        service.createDevice('org-1', 'user-1', { name: 'Router', category: DeviceCategory.ROUTER }),
      ).rejects.toThrow(NodeScopeException);

      await expect(
        service.createDevice('org-1', 'user-1', { name: 'Router', category: DeviceCategory.ROUTER }),
      ).rejects.toMatchObject({ code: 'ORG_005' });
    });

    it('throws ORG_006 NAMING_POLICY_VIOLATION when name violates namingPattern', async () => {
      mockOrgsRepo.findOrganizationById.mockResolvedValue(
        makeOrg({ namingPattern: '^[a-z]+-[0-9]{2}$' }),
      );
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);

      await expect(
        service.createDevice('org-1', 'user-1', { name: 'BadName', category: DeviceCategory.ROUTER }),
      ).rejects.toThrow(NodeScopeException);

      await expect(
        service.createDevice('org-1', 'user-1', { name: 'BadName', category: DeviceCategory.ROUTER }),
      ).rejects.toMatchObject({ code: 'ORG_006' });
    });

    it('succeeds when name matches namingPattern', async () => {
      mockOrgsRepo.findOrganizationById.mockResolvedValue(
        makeOrg({ namingPattern: '^[a-z]+-[0-9]{2}$' }),
      );
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(makeDevice({ name: 'router-01' }));

      const result = await service.createDevice('org-1', 'user-1', {
        name: 'router-01',
        category: DeviceCategory.ROUTER,
      });

      expect(result.name).toBe('router-01');
    });

    it('throws ORG_006 when name exceeds namingMaxLen', async () => {
      mockOrgsRepo.findOrganizationById.mockResolvedValue(makeOrg({ namingMaxLen: 5 }));
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);

      await expect(
        service.createDevice('org-1', 'user-1', { name: 'TooLongName', category: DeviceCategory.ROUTER }),
      ).rejects.toMatchObject({ code: 'ORG_006' });
    });

    it('does not call TiersService (tier limit removed)', async () => {
      mockOrgsRepo.findOrganizationById.mockResolvedValue(makeOrg());
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(makeDevice());

      await service.createDevice('org-1', 'user-1', { name: 'Router', category: DeviceCategory.ROUTER });

      // TiersService is not injected — no mock to check. Absence of DEVICE_002 error
      // and no countByOrgId call for limit checks confirms tiers are bypassed.
      expect(mockRepo.countByOrgId).not.toHaveBeenCalled();
    });
  });

  describe('getDevice', () => {
    it('returns DeviceDto for existing device in org', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeDevice());

      const result = await service.getDevice('org-1', 'dev-1');
      expect(result.id).toBe('dev-1');
      expect(mockRepo.findByIdAndOrgId).toHaveBeenCalledWith('dev-1', 'org-1');
    });

    it('throws DEVICE_001 when device not found in org', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);

      await expect(service.getDevice('org-1', 'missing')).rejects.toThrow(NodeScopeException);
      await expect(service.getDevice('org-1', 'missing')).rejects.toMatchObject({ code: 'DEVICE_001' });
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

      const result = await service.updateDevice('org-1', 'dev-1', {
        baseVersion: 1,
        changes: [{ field: 'name', oldValue: 'Router', newValue: 'Updated Router' }],
      });

      expect(result.name).toBe('Updated Router');
      expect(result.version).toBe(2);
      expect(mockConflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:device:updated',
        expect.objectContaining({ deviceId: 'dev-1' }),
        expect.any(String),
      );
    });

    it('throws ORG_005 DEVICE_NAME_TAKEN on name collision during update', async () => {
      const device = makeDevice();
      mockRepo.findByIdAndOrgId.mockResolvedValue(device);
      mockConflict.buildUpdatePayload.mockReturnValue({ name: 'Taken Name' });
      mockOrgsRepo.findOrganizationById.mockResolvedValue(makeOrg());
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(true);

      await expect(
        service.updateDevice('org-1', 'dev-1', {
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
        service.updateDevice('org-1', 'dev-1', {
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
        service.updateDevice('org-1', 'dev-1', {
          baseVersion: 1,
          changes: [{ field: 'notes', oldValue: null, newValue: 'new notes' }],
        }),
      ).rejects.toMatchObject({ code: 'SYNC_001' });
    });

    it('throws DEVICE_001 when device not found in org', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);

      await expect(
        service.updateDevice('org-1', 'missing', {
          baseVersion: 1,
          changes: [{ field: 'notes', oldValue: null, newValue: 'x' }],
        }),
      ).rejects.toMatchObject({ code: 'DEVICE_001' });
    });
  });

  describe('deleteDevice', () => {
    it('deletes device and emits WS event', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeDevice());
      mockRepo.deleteByIdAndOrgId.mockResolvedValue(undefined);

      await service.deleteDevice('org-1', 'dev-1');

      expect(mockRepo.deleteByIdAndOrgId).toHaveBeenCalledWith('dev-1', 'org-1');
      expect(mockConflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:device:deleted',
        expect.objectContaining({ deviceId: 'dev-1' }),
        expect.any(String),
      );
    });

    it('throws DEVICE_001 when device not found', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);

      await expect(service.deleteDevice('org-1', 'missing')).rejects.toMatchObject({
        code: 'DEVICE_001',
      });
    });
  });

  describe('createBrowserDevice', () => {
    it('returns existing device when (orgId, browserDeviceId) row already present', async () => {
      const existing = makeDevice({
        id: 'browser-1',
        category: DeviceCategory.BROWSER_CLIENT,
        browserDeviceId: 'bd-uuid-123',
        mobility: DeviceMobility.HOME_ONLY,
      });
      mockRepo.findByOrgIdAndBrowserDeviceId.mockResolvedValue(existing);

      const result = await service.createBrowserDevice(
        'org-1', 'user-1', 'bd-uuid-123', 'New name attempted', DeviceMobility.ROAMS,
      );

      expect(result.id).toBe('browser-1');
      expect(mockRepo.create).not.toHaveBeenCalled();
      expect(mockRepo.existsByNameCaseInsensitive).not.toHaveBeenCalled();
    });

    it('creates a new BROWSER_CLIENT device when none exists for the browser', async () => {
      mockRepo.findByOrgIdAndBrowserDeviceId.mockResolvedValue(null);
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(makeDevice({
        id: 'browser-1',
        category: DeviceCategory.BROWSER_CLIENT,
        browserDeviceId: 'bd-uuid-123',
        mobility: DeviceMobility.HOME_ONLY,
        name: 'My Laptop',
      }));

      const result = await service.createBrowserDevice(
        'org-1', 'user-1', 'bd-uuid-123', 'My Laptop', DeviceMobility.HOME_ONLY,
      );

      expect(result.id).toBe('browser-1');
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          userId: 'user-1',
          category: DeviceCategory.BROWSER_CLIENT,
          browserDeviceId: 'bd-uuid-123',
          mobility: DeviceMobility.HOME_ONLY,
          name: 'My Laptop',
        }),
      );
    });

    it('throws ORG_005 DEVICE_NAME_TAKEN when name collides on first creation', async () => {
      mockRepo.findByOrgIdAndBrowserDeviceId.mockResolvedValue(null);
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(true);

      await expect(
        service.createBrowserDevice('org-1', 'user-1', 'bd-1', 'Existing Name', DeviceMobility.UNKNOWN),
      ).rejects.toMatchObject({ code: 'ORG_005' });
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('passes networkId through when provided', async () => {
      mockRepo.findByOrgIdAndBrowserDeviceId.mockResolvedValue(null);
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(makeDevice({ category: DeviceCategory.BROWSER_CLIENT, networkId: 'net-1' }));

      await service.createBrowserDevice(
        'org-1', 'user-1', 'bd-1', 'Laptop', DeviceMobility.HOME_ONLY, 'net-1',
      );

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ networkId: 'net-1' }),
      );
    });

    it('emits DEVICE_UPDATED WS event on successful create', async () => {
      mockRepo.findByOrgIdAndBrowserDeviceId.mockResolvedValue(null);
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(makeDevice({ category: DeviceCategory.BROWSER_CLIENT }));

      await service.createBrowserDevice('org-1', 'user-1', 'bd-1', 'X', DeviceMobility.UNKNOWN);

      expect(mockConflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:device:updated',
        expect.objectContaining({ updatedBy: 'user-1' }),
        'user-1',
      );
    });
  });

  describe('findDeviceIdByBrowserDeviceId', () => {
    it('returns device.id when (orgId, browserDeviceId) row exists', async () => {
      mockRepo.findByOrgIdAndBrowserDeviceId.mockResolvedValue(
        makeDevice({ id: 'browser-7', browserDeviceId: 'bd-uuid' }),
      );

      const result = await service.findDeviceIdByBrowserDeviceId('org-1', 'bd-uuid');

      expect(result).toBe('browser-7');
      expect(mockRepo.findByOrgIdAndBrowserDeviceId).toHaveBeenCalledWith('org-1', 'bd-uuid');
    });

    it('returns null when no matching device exists', async () => {
      mockRepo.findByOrgIdAndBrowserDeviceId.mockResolvedValue(null);

      const result = await service.findDeviceIdByBrowserDeviceId('org-1', 'unknown-bd');

      expect(result).toBeNull();
    });
  });
});
