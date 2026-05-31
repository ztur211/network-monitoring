import { Test, TestingModule } from '@nestjs/testing';
import { FiberRunsService } from '../fiber-runs.service';
import { FiberRunsRepository } from '../fiber-runs.repository';
import { DevicesRepository } from '../../devices/devices.repository';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

const makeFiberRun = (overrides = {}) => ({
  id: 'run-1',
  userId: 'user-1',
  name: 'Fiber A to B',
  startDeviceId: 'dev-a',
  endDeviceId: 'dev-b',
  cableType: null,
  lengthMeters: null,
  notes: null,
  version: 1,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

const makeDevice = (id: string) => ({
  id,
  userId: 'user-1',
  networkId: null,
  name: `Device ${id}`,
  category: 'ROUTER' as const,
  mobility: 'UNKNOWN' as const,
  browserDeviceId: null,
  latitude: null,
  longitude: null,
  floor: null,
  floorLabel: null,
  ipAddress: null,
  macAddress: null,
  notes: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const mockRepo: jest.Mocked<FiberRunsRepository> = {
  findAllByUserId: jest.fn(),
  findByIdAndUserId: jest.fn(),
  create: jest.fn(),
  updateWithVersion: jest.fn(),
  deleteByIdAndUserId: jest.fn(),
  countByUserId: jest.fn(),
} as unknown as jest.Mocked<FiberRunsRepository>;

const mockDevicesRepo: jest.Mocked<DevicesRepository> = {
  findByIdAndUserId: jest.fn(),
} as unknown as jest.Mocked<DevicesRepository>;

const mockConflict: jest.Mocked<ConflictResolutionService> = {
  buildUpdatePayload: jest.fn(),
  emitEntityEvent: jest.fn(),
} as unknown as jest.Mocked<ConflictResolutionService>;

describe('FiberRunsService', () => {
  let service: FiberRunsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiberRunsService,
        { provide: FiberRunsRepository, useValue: mockRepo },
        { provide: DevicesRepository, useValue: mockDevicesRepo },
        { provide: ConflictResolutionService, useValue: mockConflict },
      ],
    }).compile();

    service = module.get<FiberRunsService>(FiberRunsService);
    jest.clearAllMocks();
  });

  describe('listFiberRuns', () => {
    it('returns all fiber runs for user', async () => {
      mockRepo.findAllByUserId.mockResolvedValue([makeFiberRun()]);
      mockRepo.countByUserId.mockResolvedValue(1);

      const result = await service.listFiberRuns('user-1');
      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe('run-1');
    });
  });

  describe('createFiberRun', () => {
    it('creates fiber run when devices belong to user and differ', async () => {
      mockDevicesRepo.findByIdAndUserId
        .mockResolvedValueOnce(makeDevice('dev-a'))
        .mockResolvedValueOnce(makeDevice('dev-b'));
      mockRepo.create.mockResolvedValue(makeFiberRun());

      const result = await service.createFiberRun('user-1', {
        name: 'Fiber A to B',
        startDeviceId: 'dev-a',
        endDeviceId: 'dev-b',
      });
      expect(result.id).toBe('run-1');
    });

    it('throws FIBER_002 when startDeviceId equals endDeviceId', async () => {
      await expect(
        service.createFiberRun('user-1', {
          name: 'Same device',
          startDeviceId: 'dev-a',
          endDeviceId: 'dev-a',
        }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('throws DEVICE_001 when start device not found', async () => {
      mockDevicesRepo.findByIdAndUserId.mockResolvedValueOnce(null);

      await expect(
        service.createFiberRun('user-1', {
          name: 'Fiber',
          startDeviceId: 'missing',
          endDeviceId: 'dev-b',
        }),
      ).rejects.toThrow(NodeScopeException);
    });
  });

  describe('getFiberRun', () => {
    it('returns fiber run when found', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(makeFiberRun());

      const result = await service.getFiberRun('user-1', 'run-1');
      expect(result.id).toBe('run-1');
    });

    it('throws FIBER_001 when not found', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(null);

      await expect(service.getFiberRun('user-1', 'missing')).rejects.toThrow(NodeScopeException);
    });
  });

  describe('updateFiberRun', () => {
    it('applies changeset and returns updated dto', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(makeFiberRun());
      mockConflict.buildUpdatePayload.mockReturnValue({ name: 'Updated' });
      mockRepo.updateWithVersion.mockResolvedValue(makeFiberRun({ name: 'Updated', version: 2 }));
      

      const result = await service.updateFiberRun('user-1', 'run-1', {
        baseVersion: 1,
        changes: [{ field: 'name', oldValue: 'Fiber A to B', newValue: 'Updated' }],
      });
      expect(result.name).toBe('Updated');
    });
  });

  describe('deleteFiberRun', () => {
    it('deletes fiber run', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(makeFiberRun());
      mockRepo.deleteByIdAndUserId.mockResolvedValue(undefined);
      

      await service.deleteFiberRun('user-1', 'run-1');
      expect(mockRepo.deleteByIdAndUserId).toHaveBeenCalledWith('run-1', 'user-1');
    });
  });
});
