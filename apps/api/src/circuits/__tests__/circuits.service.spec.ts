import { Test, TestingModule } from '@nestjs/testing';
import { CircuitsService } from '../circuits.service';
import { CircuitsRepository } from '../circuits.repository';
import { DevicesRepository } from '../../devices/devices.repository';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { AuditService } from '../../audit/audit.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

const makeCircuit = (overrides = {}) => ({
  id: 'cir-1',
  organizationId: 'org-1',
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
  organizationId: 'org-1',
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
  countByOrgId: jest.fn(),
  findByIdAndOrgId: jest.fn(),
  create: jest.fn(),
  updateWithVersion: jest.fn(),
  deleteByIdAndOrgId: jest.fn(),
} as unknown as jest.Mocked<CircuitsRepository>;

const mockDevicesRepo: jest.Mocked<DevicesRepository> = {
  findByIdAndOrgId: jest.fn(),
} as unknown as jest.Mocked<DevicesRepository>;

const mockConflict: jest.Mocked<ConflictResolutionService> = {
  buildUpdatePayload: jest.fn(),
  emitEntityEvent: jest.fn(),
} as unknown as jest.Mocked<ConflictResolutionService>;

const mockAudit = {
  recordCreate: jest.fn().mockResolvedValue(undefined),
  recordUpdate: jest.fn().mockResolvedValue(undefined),
  recordDelete: jest.fn().mockResolvedValue(undefined),
};

describe('CircuitsService', () => {
  let service: CircuitsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CircuitsService,
        { provide: CircuitsRepository, useValue: mockRepo },
        { provide: DevicesRepository, useValue: mockDevicesRepo },
        { provide: ConflictResolutionService, useValue: mockConflict },
        { provide: AuditService, useValue: mockAudit },
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
      mockRepo.countByOrgId.mockResolvedValue(5);

      const result = await service.listCircuits('org-1', { limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
      expect(result.total).toBe(5);
      expect(mockRepo.findWithCursor).toHaveBeenCalledWith('org-1', 3, undefined);
    });

    it('returns null nextCursor when results fit in one page', async () => {
      const circuits = [makeCircuit()];
      mockRepo.findWithCursor.mockResolvedValue(circuits);
      mockRepo.countByOrgId.mockResolvedValue(1);

      const result = await service.listCircuits('org-1', { limit: 50 });
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('createCircuit', () => {
    it('creates circuit without device', async () => {
      mockRepo.create.mockResolvedValue(makeCircuit());

      const result = await service.createCircuit('org-1', 'user-1', { ispName: 'Comcast', serviceType: 'Fiber' });
      expect(result.id).toBe('cir-1');
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', userId: 'user-1' }),
      );
      expect(mockAudit.recordCreate).toHaveBeenCalledWith(
        'org-1',
        'Circuit',
        expect.objectContaining({ id: 'cir-1' }),
      );
    });

    it('throws DEVICE_001 when deviceId is provided but device not found in org', async () => {
      mockDevicesRepo.findByIdAndOrgId.mockResolvedValue(null);

      await expect(
        service.createCircuit('org-1', 'user-1', { ispName: 'ISP', serviceType: 'DSL', deviceId: 'missing' }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('creates circuit with valid device in org', async () => {
      mockDevicesRepo.findByIdAndOrgId.mockResolvedValue(makeDevice('dev-1'));
      mockRepo.create.mockResolvedValue(makeCircuit({ deviceId: 'dev-1' }));

      const result = await service.createCircuit('org-1', 'user-1', {
        ispName: 'ISP',
        serviceType: 'Cable',
        deviceId: 'dev-1',
      });
      expect(result.deviceId).toBe('dev-1');
    });
  });

  describe('getCircuit', () => {
    it('returns circuit when found in org', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeCircuit());
      const result = await service.getCircuit('org-1', 'cir-1');
      expect(result.id).toBe('cir-1');
      expect(mockRepo.findByIdAndOrgId).toHaveBeenCalledWith('cir-1', 'org-1');
    });

    it('throws CIRCUIT_001 when not found', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);
      await expect(service.getCircuit('org-1', 'missing')).rejects.toThrow(NodeScopeException);
    });
  });

  describe('updateCircuit', () => {
    it('applies changeset and returns updated dto', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeCircuit());
      mockConflict.buildUpdatePayload.mockReturnValue({ ispName: 'Verizon' });
      mockRepo.updateWithVersion.mockResolvedValue(makeCircuit({ ispName: 'Verizon', version: 2 }));

      const result = await service.updateCircuit('org-1', 'cir-1', {
        baseVersion: 1,
        changes: [{ field: 'ispName', oldValue: 'Comcast', newValue: 'Verizon' }],
      });
      expect(result.ispName).toBe('Verizon');
      expect(mockConflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:circuit:updated',
        expect.objectContaining({ circuitId: 'cir-1' }),
        expect.any(String),
      );
    });

    it('throws CIRCUIT_001 when not found', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);
      await expect(
        service.updateCircuit('org-1', 'missing', {
          baseVersion: 1,
          changes: [{ field: 'ispName', oldValue: 'A', newValue: 'B' }],
        }),
      ).rejects.toMatchObject({ code: 'CIRCUIT_001' });
    });

    it('throws SYNC_001 on version conflict', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeCircuit());
      mockConflict.buildUpdatePayload.mockReturnValue({ ispName: 'X' });
      mockRepo.updateWithVersion.mockResolvedValue(null);
      await expect(
        service.updateCircuit('org-1', 'cir-1', {
          baseVersion: 1,
          changes: [{ field: 'ispName', oldValue: 'A', newValue: 'X' }],
        }),
      ).rejects.toMatchObject({ code: 'SYNC_001' });
    });
  });

  describe('deleteCircuit', () => {
    it('deletes and publishes event', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeCircuit());
      mockRepo.deleteByIdAndOrgId.mockResolvedValue(undefined);

      await service.deleteCircuit('org-1', 'cir-1');
      expect(mockRepo.deleteByIdAndOrgId).toHaveBeenCalledWith('cir-1', 'org-1');
      expect(mockConflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:circuit:deleted',
        expect.objectContaining({ circuitId: 'cir-1' }),
        expect.any(String),
      );
    });

    it('throws CIRCUIT_001 when not found', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);
      await expect(service.deleteCircuit('org-1', 'missing')).rejects.toMatchObject({
        code: 'CIRCUIT_001',
      });
    });
  });
});
