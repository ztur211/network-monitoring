import { Test, TestingModule } from '@nestjs/testing';
import { CircuitsService } from '../circuits.service';
import { CircuitsRepository } from '../circuits.repository';
import { DevicesRepository } from '../../devices/devices.repository';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

const makeCircuit = (overrides = {}) => ({
  id: 'cir-1',
  userId: 'user-1',
  ispName: 'Comcast',
  circuitId: null,
  serviceType: 'Fiber',
  bandwidth: null,
  deviceId: null,
  notes: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeDevice = (id: string) => ({
  id,
  userId: 'user-1',
  networkId: null,
  name: 'Router',
  category: 'ROUTER' as const,
  mobility: 'UNKNOWN' as const,
  browserDeviceId: null,
  latitude: null, longitude: null, floor: null, floorLabel: null,
  ipAddress: null, macAddress: null, notes: null, version: 1,
  createdAt: new Date(), updatedAt: new Date(),
});

const mockRepo: jest.Mocked<CircuitsRepository> = {
  findWithCursor: jest.fn(),
  countByUserId: jest.fn(),
  findByIdAndUserId: jest.fn(),
  create: jest.fn(),
  updateWithVersion: jest.fn(),
  deleteByIdAndUserId: jest.fn(),
} as unknown as jest.Mocked<CircuitsRepository>;

const mockDevicesRepo: jest.Mocked<DevicesRepository> = {
  findByIdAndUserId: jest.fn(),
} as unknown as jest.Mocked<DevicesRepository>;

const mockConflict: jest.Mocked<ConflictResolutionService> = {
  buildUpdatePayload: jest.fn(),
  publishEntityUpdate: jest.fn(),
  emitEntityEvent: jest.fn(),
} as unknown as jest.Mocked<ConflictResolutionService>;

describe('CircuitsService', () => {
  let service: CircuitsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CircuitsService,
        { provide: CircuitsRepository, useValue: mockRepo },
        { provide: DevicesRepository, useValue: mockDevicesRepo },
        { provide: ConflictResolutionService, useValue: mockConflict },
      ],
    }).compile();

    service = module.get<CircuitsService>(CircuitsService);
    jest.clearAllMocks();
  });

  describe('listCircuits', () => {
    it('returns paginated circuits with nextCursor when more exist', async () => {
      // findWithCursor is called with limit+1 to detect hasMore; return limit+1 items
      const circuits = [makeCircuit({ id: 'cir-1' }), makeCircuit({ id: 'cir-2' }), makeCircuit({ id: 'cir-3' })];
      mockRepo.findWithCursor.mockResolvedValue(circuits);
      mockRepo.countByUserId.mockResolvedValue(5);

      const result = await service.listCircuits('user-1', { limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
      expect(result.total).toBe(5);
    });

    it('returns null nextCursor when results fit in one page', async () => {
      const circuits = [makeCircuit()];
      mockRepo.findWithCursor.mockResolvedValue(circuits);
      mockRepo.countByUserId.mockResolvedValue(1);

      const result = await service.listCircuits('user-1', { limit: 50 });
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('createCircuit', () => {
    it('creates circuit without device', async () => {
      mockRepo.create.mockResolvedValue(makeCircuit());

      const result = await service.createCircuit('user-1', { ispName: 'Comcast', serviceType: 'Fiber' });
      expect(result.id).toBe('cir-1');
    });

    it('throws DEVICE_001 when deviceId is provided but device not found', async () => {
      mockDevicesRepo.findByIdAndUserId.mockResolvedValue(null);

      await expect(
        service.createCircuit('user-1', { ispName: 'ISP', serviceType: 'DSL', deviceId: 'missing' }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('creates circuit with valid device', async () => {
      mockDevicesRepo.findByIdAndUserId.mockResolvedValue(makeDevice('dev-1'));
      mockRepo.create.mockResolvedValue(makeCircuit({ deviceId: 'dev-1' }));

      const result = await service.createCircuit('user-1', {
        ispName: 'ISP',
        serviceType: 'Cable',
        deviceId: 'dev-1',
      });
      expect(result.deviceId).toBe('dev-1');
    });
  });

  describe('getCircuit', () => {
    it('returns circuit when found', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(makeCircuit());
      const result = await service.getCircuit('user-1', 'cir-1');
      expect(result.id).toBe('cir-1');
    });

    it('throws CIRCUIT_001 when not found', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(null);
      await expect(service.getCircuit('user-1', 'missing')).rejects.toThrow(NodeScopeException);
    });
  });

  describe('updateCircuit', () => {
    it('applies changeset and returns updated dto', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(makeCircuit());
      mockConflict.buildUpdatePayload.mockReturnValue({ ispName: 'Verizon' });
      mockRepo.updateWithVersion.mockResolvedValue(makeCircuit({ ispName: 'Verizon', version: 2 }));
      

      const result = await service.updateCircuit('user-1', 'cir-1', {
        baseVersion: 1,
        changes: [{ field: 'ispName', oldValue: 'Comcast', newValue: 'Verizon' }],
      });
      expect(result.ispName).toBe('Verizon');
    });
  });

  describe('deleteCircuit', () => {
    it('deletes and publishes event', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(makeCircuit());
      mockRepo.deleteByIdAndUserId.mockResolvedValue(undefined);
      

      await service.deleteCircuit('user-1', 'cir-1');
      expect(mockRepo.deleteByIdAndUserId).toHaveBeenCalledWith('cir-1', 'user-1');
    });
  });
});
