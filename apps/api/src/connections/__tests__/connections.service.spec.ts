import { Test, TestingModule } from '@nestjs/testing';
import { ConnectionsService } from '../connections.service';
import { ConnectionsRepository } from '../connections.repository';
import { DevicesRepository } from '../../devices/devices.repository';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import { ConnectionType } from '@prisma/client';

const makeConnection = (overrides = {}) => ({
  id: 'conn-1',
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
  userId: 'user-1',
  networkId: null,
  name: `Device ${id}`,
  category: 'ROUTER' as const,
  mobility: 'UNKNOWN' as const,
  browserDeviceId: null,
  latitude: null, longitude: null, floor: null, floorLabel: null,
  ipAddress: null, macAddress: null, notes: null, version: 1,
  createdAt: new Date(), updatedAt: new Date(),
});

const mockRepo: jest.Mocked<ConnectionsRepository> = {
  findAllByUserId: jest.fn(),
  findByIdAndUserId: jest.fn(),
  create: jest.fn(),
  updateWithVersion: jest.fn(),
  deleteByIdAndUserId: jest.fn(),
  countByUserId: jest.fn(),
  existsDuplicate: jest.fn(),
} as unknown as jest.Mocked<ConnectionsRepository>;

const mockDevicesRepo: jest.Mocked<DevicesRepository> = {
  findByIdAndUserId: jest.fn(),
} as unknown as jest.Mocked<DevicesRepository>;

const mockConflict: jest.Mocked<ConflictResolutionService> = {
  buildUpdatePayload: jest.fn(),
  emitEntityEvent: jest.fn(),
} as unknown as jest.Mocked<ConflictResolutionService>;

describe('ConnectionsService', () => {
  let service: ConnectionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionsService,
        { provide: ConnectionsRepository, useValue: mockRepo },
        { provide: DevicesRepository, useValue: mockDevicesRepo },
        { provide: ConflictResolutionService, useValue: mockConflict },
      ],
    }).compile();

    service = module.get<ConnectionsService>(ConnectionsService);
    jest.clearAllMocks();
  });

  describe('listConnections', () => {
    const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

    it('lists all connections when no deviceId filter is given', async () => {
      mockRepo.findAllByUserId.mockResolvedValue([]);
      mockRepo.countByUserId.mockResolvedValue(0);

      const result = await service.listConnections('user-1');

      expect(result).toEqual({ items: [], total: 0 });
      expect(mockRepo.findAllByUserId).toHaveBeenCalledWith('user-1', undefined);
    });

    it('passes a valid UUID deviceId through to the repository', async () => {
      mockRepo.findAllByUserId.mockResolvedValue([makeConnection()]);
      mockRepo.countByUserId.mockResolvedValue(1);

      await service.listConnections('user-1', VALID_UUID);

      expect(mockRepo.findAllByUserId).toHaveBeenCalledWith('user-1', VALID_UUID);
    });

    it('rejects an array-shaped deviceId with GEN_001 instead of 500-ing in Prisma', async () => {
      // Express's qs parses `?deviceId[]=a&deviceId[]=b` into an array.
      const arrayDeviceId = ['dev-a', 'dev-b'] as unknown as string;

      await expect(service.listConnections('user-1', arrayDeviceId)).rejects.toMatchObject({
        code: 'GEN_001',
      });
      expect(mockRepo.findAllByUserId).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID deviceId with GEN_001', async () => {
      await expect(service.listConnections('user-1', 'not-a-uuid')).rejects.toMatchObject({
        code: 'GEN_001',
      });
      expect(mockRepo.findAllByUserId).not.toHaveBeenCalled();
    });
  });

  describe('createConnection', () => {
    it('creates connection for valid different devices', async () => {
      mockDevicesRepo.findByIdAndUserId
        .mockResolvedValueOnce(makeDevice('dev-a'))
        .mockResolvedValueOnce(makeDevice('dev-b'));
      mockRepo.existsDuplicate.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(makeConnection());

      const result = await service.createConnection('user-1', {
        sourceDeviceId: 'dev-a',
        targetDeviceId: 'dev-b',
        connectionType: ConnectionType.ETHERNET,
      });
      expect(result.id).toBe('conn-1');
    });

    it('throws CONN_002 for self-connection', async () => {
      await expect(
        service.createConnection('user-1', {
          sourceDeviceId: 'dev-a',
          targetDeviceId: 'dev-a',
          connectionType: ConnectionType.ETHERNET,
        }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('throws CONN_003 for duplicate connection', async () => {
      mockDevicesRepo.findByIdAndUserId
        .mockResolvedValueOnce(makeDevice('dev-a'))
        .mockResolvedValueOnce(makeDevice('dev-b'));
      mockRepo.existsDuplicate.mockResolvedValue(true);

      await expect(
        service.createConnection('user-1', {
          sourceDeviceId: 'dev-a',
          targetDeviceId: 'dev-b',
          connectionType: ConnectionType.ETHERNET,
        }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('throws DEVICE_001 when source device not found', async () => {
      mockDevicesRepo.findByIdAndUserId.mockResolvedValue(null);

      await expect(
        service.createConnection('user-1', {
          sourceDeviceId: 'missing',
          targetDeviceId: 'dev-b',
          connectionType: ConnectionType.ETHERNET,
        }),
      ).rejects.toThrow(NodeScopeException);
    });
  });

  describe('getConnection', () => {
    it('returns connection when found', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(makeConnection());
      const result = await service.getConnection('user-1', 'conn-1');
      expect(result.id).toBe('conn-1');
    });

    it('throws CONN_001 when not found', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(null);
      await expect(service.getConnection('user-1', 'missing')).rejects.toThrow(NodeScopeException);
    });
  });

  describe('updateConnection', () => {
    it('applies changeset and returns updated dto', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(makeConnection());
      mockConflict.buildUpdatePayload.mockReturnValue({ notes: 'new note' });
      mockRepo.updateWithVersion.mockResolvedValue(makeConnection({ notes: 'new note', version: 2 }));
      

      const result = await service.updateConnection('user-1', 'conn-1', {
        baseVersion: 1,
        changes: [{ field: 'notes', oldValue: null, newValue: 'new note' }],
      });
      expect(result.notes).toBe('new note');
    });
  });

  describe('deleteConnection', () => {
    it('deletes and publishes event', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(makeConnection());
      mockRepo.deleteByIdAndUserId.mockResolvedValue(undefined);
      

      await service.deleteConnection('user-1', 'conn-1');
      expect(mockRepo.deleteByIdAndUserId).toHaveBeenCalledWith('conn-1', 'user-1');
    });
  });
});
