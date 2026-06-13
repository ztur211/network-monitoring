import { Test, TestingModule } from '@nestjs/testing';
import { ConnectionsService } from '../connections.service';
import { ConnectionsRepository } from '../connections.repository';
import { DevicesRepository } from '../../devices/devices.repository';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { AuditService } from '../../audit/audit.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import { ConnectionType } from '@prisma/client';

const makeConnection = (overrides = {}) => ({
  id: 'conn-1',
  organizationId: 'org-1',
  userId: 'user-1',
  sourceDeviceId: 'dev-a',
  targetDeviceId: 'dev-b',
  connectionType: ConnectionType.ETHERNET,
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
  networkId: 'net-1',
  propertyId: 'prop-1',
  roleCode: null,
  name: `Device ${id}`,
  category: 'ROUTER' as const,
  mobility: 'UNKNOWN' as const,
  latitude: null, longitude: null, floor: null, floorLabel: null,
  ipAddress: null, macAddress: null, notes: null, version: 1,
  createdAt: new Date(), updatedAt: new Date(),
});

const mockRepo: jest.Mocked<ConnectionsRepository> = {
  findAllByOrgId: jest.fn(),
  findByIdAndOrgId: jest.fn(),
  create: jest.fn(),
  updateWithVersion: jest.fn(),
  deleteByIdAndOrgId: jest.fn(),
  countByOrgId: jest.fn(),
  existsDuplicate: jest.fn(),
} as unknown as jest.Mocked<ConnectionsRepository>;

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

describe('ConnectionsService', () => {
  let service: ConnectionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionsService,
        { provide: ConnectionsRepository, useValue: mockRepo },
        { provide: DevicesRepository, useValue: mockDevicesRepo },
        { provide: ConflictResolutionService, useValue: mockConflict },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<ConnectionsService>(ConnectionsService);
    jest.clearAllMocks();
  });

  describe('listConnections', () => {
    const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

    it('lists all connections when no deviceId filter is given', async () => {
      mockRepo.findAllByOrgId.mockResolvedValue([]);
      mockRepo.countByOrgId.mockResolvedValue(0);

      const result = await service.listConnections('org-1');

      expect(result).toEqual({ items: [], total: 0 });
      expect(mockRepo.findAllByOrgId).toHaveBeenCalledWith('org-1', undefined);
    });

    it('passes a valid UUID deviceId through to the repository', async () => {
      mockRepo.findAllByOrgId.mockResolvedValue([makeConnection()]);
      mockRepo.countByOrgId.mockResolvedValue(1);

      await service.listConnections('org-1', VALID_UUID);

      expect(mockRepo.findAllByOrgId).toHaveBeenCalledWith('org-1', VALID_UUID);
    });

    it('rejects an array-shaped deviceId with GEN_001 instead of 500-ing in Prisma', async () => {
      const arrayDeviceId = ['dev-a', 'dev-b'] as unknown as string;

      await expect(service.listConnections('org-1', arrayDeviceId)).rejects.toMatchObject({
        code: 'GEN_001',
      });
      expect(mockRepo.findAllByOrgId).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID deviceId with GEN_001', async () => {
      await expect(service.listConnections('org-1', 'not-a-uuid')).rejects.toMatchObject({
        code: 'GEN_001',
      });
      expect(mockRepo.findAllByOrgId).not.toHaveBeenCalled();
    });
  });

  describe('createConnection', () => {
    it('creates connection for valid different devices in the org', async () => {
      mockDevicesRepo.findByIdAndOrgId
        .mockResolvedValueOnce(makeDevice('dev-a'))
        .mockResolvedValueOnce(makeDevice('dev-b'));
      mockRepo.existsDuplicate.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(makeConnection());

      const result = await service.createConnection('org-1', 'user-1', {
        sourceDeviceId: 'dev-a',
        targetDeviceId: 'dev-b',
        connectionType: ConnectionType.ETHERNET,
      });
      expect(result.id).toBe('conn-1');
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', userId: 'user-1' }),
      );
      expect(mockAudit.recordCreate).toHaveBeenCalledWith(
        'org-1',
        'DeviceConnection',
        expect.objectContaining({ id: 'conn-1' }),
      );
    });

    it('throws CONN_002 for self-connection', async () => {
      await expect(
        service.createConnection('org-1', 'user-1', {
          sourceDeviceId: 'dev-a',
          targetDeviceId: 'dev-a',
          connectionType: ConnectionType.ETHERNET,
        }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('throws CONN_003 for duplicate connection', async () => {
      mockDevicesRepo.findByIdAndOrgId
        .mockResolvedValueOnce(makeDevice('dev-a'))
        .mockResolvedValueOnce(makeDevice('dev-b'));
      mockRepo.existsDuplicate.mockResolvedValue(true);

      await expect(
        service.createConnection('org-1', 'user-1', {
          sourceDeviceId: 'dev-a',
          targetDeviceId: 'dev-b',
          connectionType: ConnectionType.ETHERNET,
        }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('throws DEVICE_001 when source device not found in org', async () => {
      mockDevicesRepo.findByIdAndOrgId.mockResolvedValue(null);

      await expect(
        service.createConnection('org-1', 'user-1', {
          sourceDeviceId: 'missing',
          targetDeviceId: 'dev-b',
          connectionType: ConnectionType.ETHERNET,
        }),
      ).rejects.toThrow(NodeScopeException);
    });
  });

  describe('getConnection', () => {
    it('returns connection when found in org', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeConnection());
      const result = await service.getConnection('org-1', 'conn-1');
      expect(result.id).toBe('conn-1');
      expect(mockRepo.findByIdAndOrgId).toHaveBeenCalledWith('conn-1', 'org-1');
    });

    it('throws CONN_001 when not found', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);
      await expect(service.getConnection('org-1', 'missing')).rejects.toThrow(NodeScopeException);
    });
  });

  describe('updateConnection', () => {
    it('applies changeset and returns updated dto', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeConnection());
      mockConflict.buildUpdatePayload.mockReturnValue({ notes: 'new note' });
      mockRepo.updateWithVersion.mockResolvedValue(makeConnection({ notes: 'new note', version: 2 }));

      const result = await service.updateConnection('org-1', 'conn-1', {
        baseVersion: 1,
        changes: [{ field: 'notes', oldValue: null, newValue: 'new note' }],
      });
      expect(result.notes).toBe('new note');
      expect(mockConflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:connection:updated',
        expect.objectContaining({ connectionId: 'conn-1' }),
        expect.any(String),
      );
    });

    it('throws CONN_001 when not found', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);
      await expect(
        service.updateConnection('org-1', 'missing', {
          baseVersion: 1,
          changes: [{ field: 'notes', oldValue: null, newValue: 'x' }],
        }),
      ).rejects.toMatchObject({ code: 'CONN_001' });
    });

    it('throws SYNC_001 on version conflict', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeConnection());
      mockConflict.buildUpdatePayload.mockReturnValue({ notes: 'x' });
      mockRepo.updateWithVersion.mockResolvedValue(null);
      await expect(
        service.updateConnection('org-1', 'conn-1', {
          baseVersion: 1,
          changes: [{ field: 'notes', oldValue: null, newValue: 'x' }],
        }),
      ).rejects.toMatchObject({ code: 'SYNC_001' });
    });
  });

  describe('deleteConnection', () => {
    it('deletes and publishes event', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(makeConnection());
      mockRepo.deleteByIdAndOrgId.mockResolvedValue(undefined);

      await service.deleteConnection('org-1', 'conn-1');
      expect(mockRepo.deleteByIdAndOrgId).toHaveBeenCalledWith('conn-1', 'org-1');
      expect(mockConflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:connection:deleted',
        expect.objectContaining({ connectionId: 'conn-1' }),
        expect.any(String),
      );
    });

    it('throws CONN_001 when not found', async () => {
      mockRepo.findByIdAndOrgId.mockResolvedValue(null);
      await expect(service.deleteConnection('org-1', 'missing')).rejects.toMatchObject({
        code: 'CONN_001',
      });
    });
  });
});
