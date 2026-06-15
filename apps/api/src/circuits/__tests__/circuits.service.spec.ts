import { Test, TestingModule } from '@nestjs/testing';
import { CircuitsService } from '../circuits.service';
import { CircuitsRepository } from '../circuits.repository';
import { DevicesRepository } from '../../devices/devices.repository';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { AuditService } from '../../audit/audit.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import type { OrgMemberContext } from '../../organizations/org-context.types';

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

const makeDevice = (id: string, propertyId = 'prop-1') => ({
  id,
  organizationId: 'org-1',
  userId: 'user-1',
  networkId: 'net-1',
  propertyId,
  roleCode: null,
  name: 'Router',
  category: 'ROUTER' as const,
  mobility: 'UNKNOWN' as const,
  latitude: null, longitude: null, floor: null, floorLabel: null,
  x: null, y: null, z: null,
  ipAddress: null, macAddress: null, notes: null, version: 1,
  createdAt: new Date(), updatedAt: new Date(),
});

const ownerMember: OrgMemberContext = {
  id: 'member-owner',
  organizationId: 'org-1',
  role: 'OWNER',
};

const mockRepo: jest.Mocked<Pick<CircuitsRepository, 'findWithCursor' | 'countByOrgId' | 'findByIdAndOrgId' | 'findVisibleByIdAndOrgId' | 'create' | 'updateWithVersion' | 'deleteByIdAndOrgId'>> = {
  findWithCursor: jest.fn(),
  countByOrgId: jest.fn(),
  findByIdAndOrgId: jest.fn(),
  findVisibleByIdAndOrgId: jest.fn(),
  create: jest.fn(),
  updateWithVersion: jest.fn(),
  deleteByIdAndOrgId: jest.fn(),
};

const mockDevicesRepo: jest.Mocked<Pick<DevicesRepository, 'findByIdAndOrgId'>> = {
  findByIdAndOrgId: jest.fn(),
};

const mockConflict: jest.Mocked<Pick<ConflictResolutionService, 'buildUpdatePayload' | 'emitEntityEvent' | 'emitScoped' | 'emitScopedMulti'>> = {
  buildUpdatePayload: jest.fn(),
  emitEntityEvent: jest.fn(),
  emitScoped: jest.fn().mockResolvedValue(undefined),
  emitScopedMulti: jest.fn().mockResolvedValue(undefined),
};

const mockAudit = {
  recordCreate: jest.fn().mockResolvedValue(undefined),
  recordUpdate: jest.fn().mockResolvedValue(undefined),
  recordDelete: jest.fn().mockResolvedValue(undefined),
};

const mockPermissions: jest.Mocked<Pick<PermissionsService, 'scopeFilter' | 'assertCanConfigure'>> = {
  scopeFilter: jest.fn(),
  assertCanConfigure: jest.fn(),
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
        { provide: PermissionsService, useValue: mockPermissions },
      ],
    }).compile();

    service = module.get<CircuitsService>(CircuitsService);
    jest.clearAllMocks();

    // Default: OWNER, so scopeFilter → null and assertCanConfigure resolves
    mockPermissions.scopeFilter.mockResolvedValue(null);
    mockPermissions.assertCanConfigure.mockResolvedValue(undefined);
  });

  describe('listCircuits', () => {
    it('returns paginated circuits with nextCursor when more exist', async () => {
      // findWithCursor is called with limit+1 to detect hasMore; return limit+1 items
      const circuits = [makeCircuit({ id: 'cir-1' }), makeCircuit({ id: 'cir-2' }), makeCircuit({ id: 'cir-3' })];
      mockRepo.findWithCursor.mockResolvedValue(circuits);
      mockRepo.countByOrgId.mockResolvedValue(5);

      const result = await service.listCircuits(ownerMember, { limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
      expect(result.total).toBe(5);
      // scope is null (OWNER) → undefined passed to repo
      expect(mockRepo.findWithCursor).toHaveBeenCalledWith('org-1', 3, undefined, undefined);
    });

    it('returns null nextCursor when results fit in one page', async () => {
      const circuits = [makeCircuit()];
      mockRepo.findWithCursor.mockResolvedValue(circuits);
      mockRepo.countByOrgId.mockResolvedValue(1);

      const result = await service.listCircuits(ownerMember, { limit: 50 });
      expect(result.nextCursor).toBeNull();
    });

    it('passes scope to repo when member is scoped (non-OWNER)', async () => {
      const scope = { propertyIdIn: ['prop-1'] };
      mockPermissions.scopeFilter.mockResolvedValue(scope);
      mockRepo.findWithCursor.mockResolvedValue([]);
      mockRepo.countByOrgId.mockResolvedValue(0);

      const adminMember: OrgMemberContext = { id: 'member-admin', organizationId: 'org-1', role: 'ADMIN' };
      await service.listCircuits(adminMember, {});
      expect(mockRepo.findWithCursor).toHaveBeenCalledWith('org-1', 51, undefined, scope);
      expect(mockRepo.countByOrgId).toHaveBeenCalledWith('org-1', scope);
    });
  });

  describe('createCircuit', () => {
    it('creates circuit without device (device-less → __nosite__)', async () => {
      mockRepo.create.mockResolvedValue(makeCircuit());

      const result = await service.createCircuit(ownerMember, 'user-1', { ispName: 'Comcast', serviceType: 'Fiber' });
      expect(result.id).toBe('cir-1');
      expect(mockPermissions.assertCanConfigure).toHaveBeenCalledWith(ownerMember, '__nosite__');
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
        service.createCircuit(ownerMember, 'user-1', { ispName: 'ISP', serviceType: 'DSL', deviceId: 'missing' }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('creates circuit with valid device in org (governing site from device.propertyId)', async () => {
      mockDevicesRepo.findByIdAndOrgId.mockResolvedValue(makeDevice('dev-1', 'prop-1'));
      mockRepo.create.mockResolvedValue(makeCircuit({ deviceId: 'dev-1' }));

      const result = await service.createCircuit(ownerMember, 'user-1', {
        ispName: 'ISP',
        serviceType: 'Cable',
        deviceId: 'dev-1',
      });
      expect(result.deviceId).toBe('dev-1');
      expect(mockPermissions.assertCanConfigure).toHaveBeenCalledWith(ownerMember, 'prop-1');
    });
  });

  describe('getCircuit', () => {
    it('returns circuit when found in scope (uses findVisibleByIdAndOrgId)', async () => {
      mockRepo.findVisibleByIdAndOrgId.mockResolvedValue(makeCircuit());
      const result = await service.getCircuit(ownerMember, 'cir-1');
      expect(result.id).toBe('cir-1');
      // scope null for OWNER
      expect(mockRepo.findVisibleByIdAndOrgId).toHaveBeenCalledWith('cir-1', 'org-1', null);
    });

    it('throws CIRCUIT_001 when not found (or outside scope)', async () => {
      mockRepo.findVisibleByIdAndOrgId.mockResolvedValue(null);
      await expect(service.getCircuit(ownerMember, 'missing')).rejects.toThrow(NodeScopeException);
    });
  });

  describe('updateCircuit', () => {
    it('applies changeset and returns updated dto', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeCircuit());
      mockConflict.buildUpdatePayload.mockReturnValue({ ispName: 'Verizon' });
      mockRepo.updateWithVersion.mockResolvedValue(makeCircuit({ ispName: 'Verizon', version: 2 }));

      const result = await service.updateCircuit(ownerMember, 'cir-1', {
        baseVersion: 1,
        changes: [{ field: 'ispName', oldValue: 'Comcast', newValue: 'Verizon' }],
      });
      expect(result.ispName).toBe('Verizon');
      // device-less circuit → __nosite__ assertion
      expect(mockPermissions.assertCanConfigure).toHaveBeenCalledWith(ownerMember, '__nosite__');
      expect(mockConflict.emitScoped).toHaveBeenCalledWith(
        'org-1',
        '__nosite__',
        'v1:circuit:updated',
        expect.objectContaining({ circuitId: 'cir-1' }),
      );
    });

    it('throws CIRCUIT_001 when not found', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);
      await expect(
        service.updateCircuit(ownerMember, 'missing', {
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
        service.updateCircuit(ownerMember, 'cir-1', {
          baseVersion: 1,
          changes: [{ field: 'ispName', oldValue: 'A', newValue: 'X' }],
        }),
      ).rejects.toMatchObject({ code: 'SYNC_001' });
    });

    it('asserts against new device site when deviceId changes to a different device', async () => {
      const existingCircuit = makeCircuit({ deviceId: 'dev-1' });
      mockRepo.findByIdAndOrgId.mockResolvedValue(existingCircuit);
      // first call: current device (dev-1) propertyId = prop-1
      // second call: new device (dev-2) propertyId = prop-2
      mockDevicesRepo.findByIdAndOrgId
        .mockResolvedValueOnce(makeDevice('dev-1', 'prop-1'))
        .mockResolvedValueOnce(makeDevice('dev-2', 'prop-2'));
      mockConflict.buildUpdatePayload.mockReturnValue({ deviceId: 'dev-2' });
      mockRepo.updateWithVersion.mockResolvedValue(makeCircuit({ deviceId: 'dev-2', version: 2 }));

      await service.updateCircuit(ownerMember, 'cir-1', {
        baseVersion: 1,
        changes: [{ field: 'deviceId', oldValue: 'dev-1', newValue: 'dev-2' }],
      });

      expect(mockPermissions.assertCanConfigure).toHaveBeenCalledWith(ownerMember, 'prop-1');
      expect(mockPermissions.assertCanConfigure).toHaveBeenCalledWith(ownerMember, 'prop-2');
    });
  });

  describe('deleteCircuit', () => {
    it('deletes and publishes event', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeCircuit());
      mockRepo.deleteByIdAndOrgId.mockResolvedValue(undefined);

      await service.deleteCircuit(ownerMember, 'cir-1');
      // device-less circuit → __nosite__ assertion
      expect(mockPermissions.assertCanConfigure).toHaveBeenCalledWith(ownerMember, '__nosite__');
      expect(mockRepo.deleteByIdAndOrgId).toHaveBeenCalledWith('cir-1', 'org-1');
      expect(mockConflict.emitScoped).toHaveBeenCalledWith(
        'org-1',
        '__nosite__',
        'v1:circuit:deleted',
        expect.objectContaining({ circuitId: 'cir-1' }),
      );
    });

    it('throws CIRCUIT_001 when not found', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);
      await expect(service.deleteCircuit(ownerMember, 'missing')).rejects.toMatchObject({
        code: 'CIRCUIT_001',
      });
    });
  });
});
