import { Test, TestingModule } from '@nestjs/testing';
import { FiberRunsService } from '../fiber-runs.service';
import { FiberRunsRepository } from '../fiber-runs.repository';
import { DevicesRepository } from '../../devices/devices.repository';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { AuditService } from '../../audit/audit.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

const makeFiberRun = (overrides = {}) => ({
  id: 'run-1',
  organizationId: 'org-1',
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
  organizationId: 'org-1',
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
  findAllByOrgId: jest.fn(),
  findByIdAndOrgId: jest.fn(),
  create: jest.fn(),
  updateWithVersion: jest.fn(),
  deleteByIdAndOrgId: jest.fn(),
  countByOrgId: jest.fn(),
} as unknown as jest.Mocked<FiberRunsRepository>;

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

describe('FiberRunsService', () => {
  let service: FiberRunsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiberRunsService,
        { provide: FiberRunsRepository, useValue: mockRepo },
        { provide: DevicesRepository, useValue: mockDevicesRepo },
        { provide: ConflictResolutionService, useValue: mockConflict },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<FiberRunsService>(FiberRunsService);
    jest.clearAllMocks();
  });

  describe('listFiberRuns', () => {
    const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

    it('returns all fiber runs for org', async () => {
      mockRepo.findAllByOrgId.mockResolvedValue([makeFiberRun()]);
      mockRepo.countByOrgId.mockResolvedValue(1);

      const result = await service.listFiberRuns('org-1');
      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe('run-1');
      expect(mockRepo.findAllByOrgId).toHaveBeenCalledWith('org-1', undefined);
    });

    it('passes a valid UUID deviceId through to the repository', async () => {
      mockRepo.findAllByOrgId.mockResolvedValue([]);
      mockRepo.countByOrgId.mockResolvedValue(0);

      await service.listFiberRuns('org-1', VALID_UUID);

      expect(mockRepo.findAllByOrgId).toHaveBeenCalledWith('org-1', VALID_UUID);
    });

    it('rejects an array-shaped deviceId with GEN_001 instead of 500-ing in Prisma', async () => {
      const arrayDeviceId = ['dev-a', 'dev-b'] as unknown as string;

      await expect(service.listFiberRuns('org-1', arrayDeviceId)).rejects.toMatchObject({
        code: 'GEN_001',
      });
      expect(mockRepo.findAllByOrgId).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID deviceId with GEN_001', async () => {
      await expect(service.listFiberRuns('org-1', 'not-a-uuid')).rejects.toMatchObject({
        code: 'GEN_001',
      });
      expect(mockRepo.findAllByOrgId).not.toHaveBeenCalled();
    });
  });

  describe('createFiberRun', () => {
    it('creates fiber run when devices belong to org and differ', async () => {
      mockDevicesRepo.findByIdAndOrgId
        .mockResolvedValueOnce(makeDevice('dev-a'))
        .mockResolvedValueOnce(makeDevice('dev-b'));
      mockRepo.create.mockResolvedValue(makeFiberRun());

      const result = await service.createFiberRun('org-1', 'user-1', {
        name: 'Fiber A to B',
        startDeviceId: 'dev-a',
        endDeviceId: 'dev-b',
      });
      expect(result.id).toBe('run-1');
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', userId: 'user-1' }),
      );
      expect(mockAudit.recordCreate).toHaveBeenCalledWith(
        'org-1',
        'FiberRun',
        expect.objectContaining({ id: 'run-1' }),
      );
    });

    it('throws FIBER_002 when startDeviceId equals endDeviceId', async () => {
      await expect(
        service.createFiberRun('org-1', 'user-1', {
          name: 'Same device',
          startDeviceId: 'dev-a',
          endDeviceId: 'dev-a',
        }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('throws DEVICE_001 when start device not found in org', async () => {
      mockDevicesRepo.findByIdAndOrgId.mockResolvedValueOnce(null);

      await expect(
        service.createFiberRun('org-1', 'user-1', {
          name: 'Fiber',
          startDeviceId: 'missing',
          endDeviceId: 'dev-b',
        }),
      ).rejects.toThrow(NodeScopeException);
    });
  });

  describe('getFiberRun', () => {
    it('returns fiber run when found in org', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeFiberRun());

      const result = await service.getFiberRun('org-1', 'run-1');
      expect(result.id).toBe('run-1');
      expect(mockRepo.findByIdAndOrgId).toHaveBeenCalledWith('run-1', 'org-1');
    });

    it('throws FIBER_001 when not found', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);

      await expect(service.getFiberRun('org-1', 'missing')).rejects.toThrow(NodeScopeException);
    });
  });

  describe('updateFiberRun', () => {
    it('applies changeset and returns updated dto', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeFiberRun());
      mockConflict.buildUpdatePayload.mockReturnValue({ name: 'Updated' });
      mockRepo.updateWithVersion.mockResolvedValue(makeFiberRun({ name: 'Updated', version: 2 }));

      const result = await service.updateFiberRun('org-1', 'run-1', {
        baseVersion: 1,
        changes: [{ field: 'name', oldValue: 'Fiber A to B', newValue: 'Updated' }],
      });
      expect(result.name).toBe('Updated');
      expect(mockRepo.updateWithVersion).toHaveBeenCalledWith('run-1', 'org-1', expect.any(Object), 1);
      expect(mockConflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:fiber-run:updated',
        expect.objectContaining({ fiberRunId: 'run-1' }),
        expect.any(String),
      );
    });

    it('throws FIBER_001 when not found', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);
      await expect(
        service.updateFiberRun('org-1', 'missing', {
          baseVersion: 1,
          changes: [{ field: 'name', oldValue: 'A', newValue: 'B' }],
        }),
      ).rejects.toMatchObject({ code: 'FIBER_001' });
    });

    it('throws SYNC_001 on version conflict', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeFiberRun());
      mockConflict.buildUpdatePayload.mockReturnValue({ name: 'x' });
      mockRepo.updateWithVersion.mockResolvedValue(null);
      await expect(
        service.updateFiberRun('org-1', 'run-1', {
          baseVersion: 1,
          changes: [{ field: 'name', oldValue: 'A', newValue: 'x' }],
        }),
      ).rejects.toMatchObject({ code: 'SYNC_001' });
    });
  });

  describe('deleteFiberRun', () => {
    it('deletes fiber run and emits WS event', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeFiberRun());
      mockRepo.deleteByIdAndOrgId.mockResolvedValue(undefined);

      await service.deleteFiberRun('org-1', 'run-1');
      expect(mockRepo.deleteByIdAndOrgId).toHaveBeenCalledWith('run-1', 'org-1');
      expect(mockConflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:fiber-run:deleted',
        expect.objectContaining({ fiberRunId: 'run-1' }),
        expect.any(String),
      );
    });

    it('throws FIBER_001 when not found', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);
      await expect(service.deleteFiberRun('org-1', 'missing')).rejects.toMatchObject({
        code: 'FIBER_001',
      });
    });
  });
});
