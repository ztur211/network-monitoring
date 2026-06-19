import { Test, TestingModule } from '@nestjs/testing';
import { FiberRunsService } from '../fiber-runs.service';
import { FiberRunsRepository } from '../fiber-runs.repository';
import { DevicesRepository } from '../../devices/devices.repository';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { AuditService } from '../../audit/audit.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

const member = { id: 'm-owner', organizationId: 'org-1', role: 'OWNER' as const };

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

const makeDevice = (id: string, propertyId = 'prop-1') => ({
  id,
  organizationId: 'org-1',
  userId: 'user-1',
  networkId: 'net-1',
  propertyId,
  roleCode: null,
  name: `Device ${id}`,
  category: 'ROUTER' as const,
  mobility: 'UNKNOWN' as const,
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
  createdAt: new Date(),
  updatedAt: new Date(),
});

const mockRepo: jest.Mocked<FiberRunsRepository> = {
  findAllByOrgId: jest.fn(),
  listVisible: jest.fn(),
  findByIdAndOrgId: jest.fn(),
  findVisibleByIdAndOrgId: jest.fn(),
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
  emitScoped: jest.fn().mockResolvedValue(undefined),
  emitScopedMulti: jest.fn().mockResolvedValue(undefined),
} as unknown as jest.Mocked<ConflictResolutionService>;

const mockAudit = {
  recordCreate: jest.fn().mockResolvedValue(undefined),
  recordUpdate: jest.fn().mockResolvedValue(undefined),
  recordDelete: jest.fn().mockResolvedValue(undefined),
};

const mockPermissions = {
  scopeFilter: jest.fn().mockResolvedValue(null),
  assertCanConfigure: jest.fn().mockResolvedValue(undefined),
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
        { provide: PermissionsService, useValue: mockPermissions },
      ],
    }).compile();

    service = module.get<FiberRunsService>(FiberRunsService);
    jest.clearAllMocks();
    mockPermissions.scopeFilter.mockResolvedValue(null);
    mockPermissions.assertCanConfigure.mockResolvedValue(undefined);
  });

  describe('listFiberRuns', () => {
    const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

    it('returns all fiber runs for org', async () => {
      mockRepo.listVisible.mockResolvedValue([makeFiberRun()]);

      const result = await service.listFiberRuns(member);
      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe('run-1');
      expect(mockRepo.listVisible).toHaveBeenCalledWith('org-1', null, undefined);
    });

    it('passes a valid UUID deviceId through to the repository', async () => {
      mockRepo.listVisible.mockResolvedValue([]);

      await service.listFiberRuns(member, VALID_UUID);

      expect(mockRepo.listVisible).toHaveBeenCalledWith('org-1', null, VALID_UUID);
    });

    it('rejects an array-shaped deviceId with GEN_001 instead of 500-ing in Prisma', async () => {
      const arrayDeviceId = ['dev-a', 'dev-b'] as unknown as string;

      await expect(service.listFiberRuns(member, arrayDeviceId)).rejects.toMatchObject({
        code: 'GEN_001',
      });
      expect(mockRepo.listVisible).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID deviceId with GEN_001', async () => {
      await expect(service.listFiberRuns(member, 'not-a-uuid')).rejects.toMatchObject({
        code: 'GEN_001',
      });
      expect(mockRepo.listVisible).not.toHaveBeenCalled();
    });

    it('total equals the number of visible items returned', async () => {
      mockRepo.listVisible.mockResolvedValue([makeFiberRun(), makeFiberRun({ id: 'run-2' })]);

      const result = await service.listFiberRuns(member);
      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
    });
  });

  describe('createFiberRun', () => {
    it('creates fiber run when devices belong to org and differ', async () => {
      mockDevicesRepo.findByIdAndOrgId
        .mockResolvedValueOnce(makeDevice('dev-a', 'prop-1'))
        .mockResolvedValueOnce(makeDevice('dev-b', 'prop-2'));
      mockRepo.create.mockResolvedValue(makeFiberRun());

      const result = await service.createFiberRun(member, 'user-1', {
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
      expect(mockPermissions.assertCanConfigure).toHaveBeenCalledWith(member, 'prop-1');
      expect(mockPermissions.assertCanConfigure).toHaveBeenCalledWith(member, 'prop-2');
    });

    it('throws FIBER_002 when startDeviceId equals endDeviceId', async () => {
      await expect(
        service.createFiberRun(member, 'user-1', {
          name: 'Same device',
          startDeviceId: 'dev-a',
          endDeviceId: 'dev-a',
        }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('throws DEVICE_001 when start device not found in org', async () => {
      mockDevicesRepo.findByIdAndOrgId.mockResolvedValueOnce(null);

      await expect(
        service.createFiberRun(member, 'user-1', {
          name: 'Fiber',
          startDeviceId: 'missing',
          endDeviceId: 'dev-b',
        }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('propagates PERM_001 when ADMIN is missing endpoint site access', async () => {
      mockDevicesRepo.findByIdAndOrgId
        .mockResolvedValueOnce(makeDevice('dev-a', 'prop-1'))
        .mockResolvedValueOnce(makeDevice('dev-b', 'prop-2'));
      mockPermissions.assertCanConfigure.mockResolvedValueOnce(undefined).mockRejectedValueOnce(
        Object.assign(new Error('forbidden'), { code: 'PERM_001' }),
      );

      await expect(
        service.createFiberRun(member, 'user-1', {
          name: 'Fiber',
          startDeviceId: 'dev-a',
          endDeviceId: 'dev-b',
        }),
      ).rejects.toMatchObject({ code: 'PERM_001' });
    });
  });

  describe('getFiberRun', () => {
    it('returns fiber run when found in scope', async () => {
      mockRepo.findVisibleByIdAndOrgId.mockResolvedValue(makeFiberRun());

      const result = await service.getFiberRun(member, 'run-1');
      expect(result.id).toBe('run-1');
      expect(mockRepo.findVisibleByIdAndOrgId).toHaveBeenCalledWith('run-1', 'org-1', null);
    });

    it('throws FIBER_001 when not visible (out of scope or missing)', async () => {
      mockRepo.findVisibleByIdAndOrgId.mockResolvedValue(null);

      await expect(service.getFiberRun(member, 'missing')).rejects.toThrow(NodeScopeException);
    });
  });

  describe('updateFiberRun', () => {
    it('applies changeset and returns updated dto', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeFiberRun());
      mockDevicesRepo.findByIdAndOrgId
        .mockResolvedValueOnce(makeDevice('dev-a', 'prop-1'))
        .mockResolvedValueOnce(makeDevice('dev-b', 'prop-2'));
      mockConflict.buildUpdatePayload.mockReturnValue({ name: 'Updated' });
      mockRepo.updateWithVersion.mockResolvedValue(makeFiberRun({ name: 'Updated', version: 2 }));

      const result = await service.updateFiberRun(member, 'run-1', {
        baseVersion: 1,
        changes: [{ field: 'name', oldValue: 'Fiber A to B', newValue: 'Updated' }],
      });
      expect(result.name).toBe('Updated');
      expect(mockRepo.updateWithVersion).toHaveBeenCalledWith('run-1', 'org-1', expect.any(Object), 1);
      expect(mockConflict.emitScopedMulti).toHaveBeenCalledWith(
        'org-1',
        ['prop-1', 'prop-2'],
        'v1:fiber-run:updated',
        expect.objectContaining({ fiberRunId: 'run-1' }),
      );
    });

    it('throws FIBER_001 when not found', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);
      await expect(
        service.updateFiberRun(member, 'missing', {
          baseVersion: 1,
          changes: [{ field: 'name', oldValue: 'A', newValue: 'B' }],
        }),
      ).rejects.toMatchObject({ code: 'FIBER_001' });
    });

    it('throws SYNC_001 on version conflict', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeFiberRun());
      mockDevicesRepo.findByIdAndOrgId
        .mockResolvedValueOnce(makeDevice('dev-a'))
        .mockResolvedValueOnce(makeDevice('dev-b'));
      mockConflict.buildUpdatePayload.mockReturnValue({ name: 'x' });
      mockRepo.updateWithVersion.mockResolvedValue(null);
      await expect(
        service.updateFiberRun(member, 'run-1', {
          baseVersion: 1,
          changes: [{ field: 'name', oldValue: 'A', newValue: 'x' }],
        }),
      ).rejects.toMatchObject({ code: 'SYNC_001' });
    });

    it('propagates PERM_001 when ADMIN is missing one endpoint site', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeFiberRun());
      mockDevicesRepo.findByIdAndOrgId
        .mockResolvedValueOnce(makeDevice('dev-a', 'prop-1'))
        .mockResolvedValueOnce(makeDevice('dev-b', 'prop-2'));
      mockPermissions.assertCanConfigure.mockResolvedValueOnce(undefined).mockRejectedValueOnce(
        Object.assign(new Error('forbidden'), { code: 'PERM_001' }),
      );

      await expect(
        service.updateFiberRun(member, 'run-1', {
          baseVersion: 1,
          changes: [{ field: 'name', oldValue: 'A', newValue: 'x' }],
        }),
      ).rejects.toMatchObject({ code: 'PERM_001' });
    });
  });

  describe('deleteFiberRun', () => {
    it('deletes fiber run and emits WS event', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeFiberRun());
      mockDevicesRepo.findByIdAndOrgId
        .mockResolvedValueOnce(makeDevice('dev-a', 'prop-1'))
        .mockResolvedValueOnce(makeDevice('dev-b', 'prop-2'));
      mockRepo.deleteByIdAndOrgId.mockResolvedValue(undefined);

      await service.deleteFiberRun(member, 'run-1');
      expect(mockRepo.deleteByIdAndOrgId).toHaveBeenCalledWith('run-1', 'org-1');
      expect(mockConflict.emitScopedMulti).toHaveBeenCalledWith(
        'org-1',
        ['prop-1', 'prop-2'],
        'v1:fiber-run:deleted',
        expect.objectContaining({ fiberRunId: 'run-1' }),
      );
    });

    it('throws FIBER_001 when not found', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);
      await expect(service.deleteFiberRun(member, 'missing')).rejects.toMatchObject({
        code: 'FIBER_001',
      });
    });

    it('propagates PERM_001 when ADMIN is missing one endpoint site', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeFiberRun());
      mockDevicesRepo.findByIdAndOrgId
        .mockResolvedValueOnce(makeDevice('dev-a', 'prop-1'))
        .mockResolvedValueOnce(makeDevice('dev-b', 'prop-2'));
      mockPermissions.assertCanConfigure.mockResolvedValueOnce(undefined).mockRejectedValueOnce(
        Object.assign(new Error('forbidden'), { code: 'PERM_001' }),
      );

      await expect(service.deleteFiberRun(member, 'run-1')).rejects.toMatchObject({
        code: 'PERM_001',
      });
    });
  });
});
