import { Test, TestingModule } from '@nestjs/testing';
import { DevicesService } from '../devices.service';
import { DevicesRepository } from '../devices.repository';
import { TiersService, FREE_TIER_DEVICE_LIMIT } from '../../tiers/tiers.service';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import { DeviceCategory, DeviceMobility } from '@prisma/client';

const makeDevice = (overrides = {}) => ({
  id: 'dev-1',
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

const mockRepo: jest.Mocked<DevicesRepository> = {
  findAllByUserId: jest.fn(),
  countByUserId: jest.fn(),
  findByIdAndUserId: jest.fn(),
  findByUserIdAndBrowserDeviceId: jest.fn(),
  create: jest.fn(),
  updateWithVersion: jest.fn(),
  deleteByIdAndUserId: jest.fn(),
  existsByNameCaseInsensitive: jest.fn(),
} as unknown as jest.Mocked<DevicesRepository>;

const mockTiers: jest.Mocked<TiersService> = {
  getDeviceLimit: jest.fn(),
} as unknown as jest.Mocked<TiersService>;

const mockConflict: jest.Mocked<ConflictResolutionService> = {
  buildUpdatePayload: jest.fn(),
  publishEntityUpdate: jest.fn(),
  emitEntityEvent: jest.fn(),
} as unknown as jest.Mocked<ConflictResolutionService>;

describe('DevicesService', () => {
  let service: DevicesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevicesService,
        { provide: DevicesRepository, useValue: mockRepo },
        { provide: TiersService, useValue: mockTiers },
        { provide: ConflictResolutionService, useValue: mockConflict },
      ],
    }).compile();

    service = module.get<DevicesService>(DevicesService);
    jest.clearAllMocks();
  });

  describe('listDevices', () => {
    it('returns items and total', async () => {
      mockRepo.findAllByUserId.mockResolvedValue([makeDevice()]);
      mockRepo.countByUserId.mockResolvedValue(1);

      const result = await service.listDevices('user-1');
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('dev-1');
    });
  });

  describe('createDevice', () => {
    it('creates and returns DeviceDto when under tier limit', async () => {
      mockTiers.getDeviceLimit.mockReturnValue(50);
      mockRepo.countByUserId.mockResolvedValue(0);
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(makeDevice());

      const result = await service.createDevice('user-1', 'PERSONAL_FREE', {
        name: 'Router',
        category: DeviceCategory.ROUTER,
      });

      expect(result.id).toBe('dev-1');
      expect(mockRepo.create).toHaveBeenCalledTimes(1);
    });

    it('throws DEVICE_002 when device limit is reached', async () => {
      mockTiers.getDeviceLimit.mockReturnValue(FREE_TIER_DEVICE_LIMIT);
      mockRepo.countByUserId.mockResolvedValue(FREE_TIER_DEVICE_LIMIT);

      await expect(
        service.createDevice('user-1', 'PERSONAL_FREE', { name: 'Router', category: DeviceCategory.ROUTER }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('throws DEVICE_003 when device name is already taken', async () => {
      mockTiers.getDeviceLimit.mockReturnValue(50);
      mockRepo.countByUserId.mockResolvedValue(0);
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(true);

      await expect(
        service.createDevice('user-1', 'PERSONAL_FREE', { name: 'Router', category: DeviceCategory.ROUTER }),
      ).rejects.toThrow(NodeScopeException);
    });
  });

  describe('getDevice', () => {
    it('returns DeviceDto for existing device', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(makeDevice());

      const result = await service.getDevice('user-1', 'dev-1');
      expect(result.id).toBe('dev-1');
    });

    it('throws DEVICE_001 when device not found', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(null);

      await expect(service.getDevice('user-1', 'missing')).rejects.toThrow(NodeScopeException);
    });
  });

  describe('updateDevice', () => {
    it('applies changeset and returns updated DeviceDto', async () => {
      const device = makeDevice();
      const updated = makeDevice({ name: 'Updated Router', version: 2 });
      mockRepo.findByIdAndUserId.mockResolvedValue(device);
      mockConflict.buildUpdatePayload.mockReturnValue({ name: 'Updated Router' });
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockRepo.updateWithVersion.mockResolvedValue(updated);
      const result = await service.updateDevice('user-1', 'dev-1', {
        baseVersion: 1,
        changes: [{ field: 'name', oldValue: 'Router', newValue: 'Updated Router' }],
      });

      expect(result.name).toBe('Updated Router');
      expect(result.version).toBe(2);
      expect(mockConflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:device:updated',
        expect.objectContaining({ deviceId: 'dev-1' }),
        'user-1',
      );
    });

    it('throws SYNC_001 when concurrent update causes version conflict at DB level', async () => {
      const device = makeDevice();
      mockRepo.findByIdAndUserId.mockResolvedValue(device);
      mockConflict.buildUpdatePayload.mockReturnValue({ notes: 'new notes' });
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockRepo.updateWithVersion.mockResolvedValue(null);

      await expect(
        service.updateDevice('user-1', 'dev-1', {
          baseVersion: 1,
          changes: [{ field: 'notes', oldValue: null, newValue: 'new notes' }],
        }),
      ).rejects.toThrow(NodeScopeException);
    });
  });

  describe('deleteDevice', () => {
    it('deletes device and emits WS event', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(makeDevice());
      mockRepo.deleteByIdAndUserId.mockResolvedValue(undefined);

      await service.deleteDevice('user-1', 'dev-1');

      expect(mockRepo.deleteByIdAndUserId).toHaveBeenCalledWith('dev-1', 'user-1');
      expect(mockConflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:device:deleted',
        expect.objectContaining({ deviceId: 'dev-1' }),
        'user-1',
      );
    });

    it('throws DEVICE_001 when device not found', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(null);

      await expect(service.deleteDevice('user-1', 'missing')).rejects.toThrow(NodeScopeException);
    });
  });

  describe('createBrowserDevice', () => {
    it('returns existing device when (userId, browserDeviceId) row already present', async () => {
      const existing = makeDevice({
        id: 'browser-1',
        category: DeviceCategory.BROWSER_CLIENT,
        browserDeviceId: 'bd-uuid-123',
        mobility: DeviceMobility.HOME_ONLY,
      });
      mockRepo.findByUserIdAndBrowserDeviceId.mockResolvedValue(existing);

      const result = await service.createBrowserDevice(
        'user-1', 'bd-uuid-123', 'New name attempted', DeviceMobility.ROAMS,
      );

      expect(result.id).toBe('browser-1');
      expect(mockRepo.create).not.toHaveBeenCalled();
      expect(mockRepo.existsByNameCaseInsensitive).not.toHaveBeenCalled();
    });

    it('creates a new BROWSER_CLIENT device when none exists for the browser', async () => {
      mockRepo.findByUserIdAndBrowserDeviceId.mockResolvedValue(null);
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(makeDevice({
        id: 'browser-1',
        category: DeviceCategory.BROWSER_CLIENT,
        browserDeviceId: 'bd-uuid-123',
        mobility: DeviceMobility.HOME_ONLY,
        name: 'My Laptop',
      }));

      const result = await service.createBrowserDevice(
        'user-1', 'bd-uuid-123', 'My Laptop', DeviceMobility.HOME_ONLY,
      );

      expect(result.id).toBe('browser-1');
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          category: DeviceCategory.BROWSER_CLIENT,
          browserDeviceId: 'bd-uuid-123',
          mobility: DeviceMobility.HOME_ONLY,
          name: 'My Laptop',
        }),
      );
    });

    it('bypasses tier device-limit check (browsers do not consume slots)', async () => {
      mockRepo.findByUserIdAndBrowserDeviceId.mockResolvedValue(null);
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(makeDevice({ category: DeviceCategory.BROWSER_CLIENT }));

      await service.createBrowserDevice('user-1', 'bd-1', 'X', DeviceMobility.UNKNOWN);

      expect(mockTiers.getDeviceLimit).not.toHaveBeenCalled();
      expect(mockRepo.countByUserId).not.toHaveBeenCalled();
    });

    it('throws DEVICE_003 DEVICE_NAME_TAKEN when name collides on first creation', async () => {
      mockRepo.findByUserIdAndBrowserDeviceId.mockResolvedValue(null);
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(true);

      await expect(
        service.createBrowserDevice('user-1', 'bd-1', 'Existing Name', DeviceMobility.UNKNOWN),
      ).rejects.toThrow(NodeScopeException);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('passes networkId through when provided', async () => {
      mockRepo.findByUserIdAndBrowserDeviceId.mockResolvedValue(null);
      mockRepo.existsByNameCaseInsensitive.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(makeDevice({ category: DeviceCategory.BROWSER_CLIENT, networkId: 'net-1' }));

      await service.createBrowserDevice(
        'user-1', 'bd-1', 'Laptop', DeviceMobility.HOME_ONLY, 'net-1',
      );

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ networkId: 'net-1' }),
      );
    });
  });
});
