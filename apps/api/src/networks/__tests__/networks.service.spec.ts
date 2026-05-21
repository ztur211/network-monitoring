import { Test, TestingModule } from '@nestjs/testing';
import { NetworksService } from '../networks.service';
import { NetworksRepository } from '../networks.repository';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

const makeNetwork = (overrides = {}) => ({
  id: 'net-1',
  userId: 'user-1',
  name: 'Home',
  homeAddress: null,
  homeLatitude: null,
  homeLongitude: null,
  homePublicIp: null,
  isp: null,
  downMbps: null,
  upMbps: null,
  version: 1,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

const mockRepo: jest.Mocked<NetworksRepository> = {
  findAllByUserId: jest.fn(),
  countByUserId: jest.fn(),
  findByIdAndUserId: jest.fn(),
  create: jest.fn(),
  updateWithVersion: jest.fn(),
  deleteByIdAndUserId: jest.fn(),
} as unknown as jest.Mocked<NetworksRepository>;

const mockConflict: jest.Mocked<ConflictResolutionService> = {
  buildUpdatePayload: jest.fn(),
  publishEntityUpdate: jest.fn(),
  emitEntityEvent: jest.fn(),
} as unknown as jest.Mocked<ConflictResolutionService>;

describe('NetworksService', () => {
  let service: NetworksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NetworksService,
        { provide: NetworksRepository, useValue: mockRepo },
        { provide: ConflictResolutionService, useValue: mockConflict },
      ],
    }).compile();

    service = module.get<NetworksService>(NetworksService);
    jest.clearAllMocks();
  });

  describe('listNetworks', () => {
    it('returns NetworkSummary list without homePublicIp', async () => {
      mockRepo.findAllByUserId.mockResolvedValue([
        makeNetwork({ homePublicIp: '203.0.113.1' }),
      ]);

      const result = await service.listNetworks('user-1');
      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('homePublicIp');
      expect(result[0].id).toBe('net-1');
    });

    it('returns empty array when user has no networks', async () => {
      mockRepo.findAllByUserId.mockResolvedValue([]);
      const result = await service.listNetworks('user-1');
      expect(result).toEqual([]);
    });
  });

  describe('createNetwork', () => {
    it('creates network when user has zero existing networks', async () => {
      mockRepo.countByUserId.mockResolvedValue(0);
      mockRepo.create.mockResolvedValue(makeNetwork());

      const result = await service.createNetwork('user-1', { name: 'Home' });
      expect(result.id).toBe('net-1');
      expect(result).toHaveProperty('homePublicIp');
    });

    it('throws NETWORK_001 NETWORK_LIMIT_EXCEEDED when user already has 1 network', async () => {
      mockRepo.countByUserId.mockResolvedValue(1);

      await expect(service.createNetwork('user-1', { name: 'B' })).rejects.toThrow(
        NodeScopeException,
      );
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('emits v1:network:updated on successful create', async () => {
      mockRepo.countByUserId.mockResolvedValue(0);
      mockRepo.create.mockResolvedValue(makeNetwork());

      await service.createNetwork('user-1', { name: 'Home' });
      expect(mockConflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:network:updated',
        expect.objectContaining({ network: expect.objectContaining({ id: 'net-1' }) }),
        'user-1',
      );
    });
  });

  describe('getNetwork', () => {
    it('returns NetworkDetail including homePublicIp', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(
        makeNetwork({ homePublicIp: '203.0.113.1' }),
      );

      const result = await service.getNetwork('user-1', 'net-1');
      expect(result.homePublicIp).toBe('203.0.113.1');
    });

    it('throws NETWORK_002 NETWORK_NOT_FOUND when not found', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(null);
      await expect(service.getNetwork('user-1', 'missing')).rejects.toThrow(NodeScopeException);
    });
  });

  describe('updateNetwork', () => {
    it('applies changeset and returns NetworkDetail', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(makeNetwork());
      mockConflict.buildUpdatePayload.mockReturnValue({ name: 'Renamed' });
      mockRepo.updateWithVersion.mockResolvedValue(
        makeNetwork({ name: 'Renamed', version: 2 }),
      );

      const result = await service.updateNetwork('user-1', 'net-1', {
        baseVersion: 1,
        changes: [{ field: 'name', oldValue: 'Home', newValue: 'Renamed' }],
      });
      expect(result.name).toBe('Renamed');
      expect(result.version).toBe(2);
    });

    it('throws NETWORK_002 when target network not found before applying changeset', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(null);
      await expect(
        service.updateNetwork('user-1', 'missing', { baseVersion: 1, changes: [] }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('throws SYNC_001 when optimistic-concurrency check fails at write', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(makeNetwork());
      mockConflict.buildUpdatePayload.mockReturnValue({ name: 'X' });
      mockRepo.updateWithVersion.mockResolvedValue(null);

      await expect(
        service.updateNetwork('user-1', 'net-1', {
          baseVersion: 1,
          changes: [{ field: 'name', oldValue: 'A', newValue: 'X' }],
        }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('emits v1:network:updated with the updated dto and changes', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(makeNetwork());
      mockConflict.buildUpdatePayload.mockReturnValue({ name: 'Renamed' });
      const updated = makeNetwork({ name: 'Renamed', version: 2 });
      mockRepo.updateWithVersion.mockResolvedValue(updated);

      await service.updateNetwork('user-1', 'net-1', {
        baseVersion: 1,
        changes: [{ field: 'name', oldValue: 'Home', newValue: 'Renamed' }],
      });

      expect(mockConflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:network:updated',
        expect.objectContaining({
          networkId: 'net-1',
          network: expect.objectContaining({ name: 'Renamed', version: 2 }),
        }),
        'user-1',
      );
    });
  });

  describe('deleteNetwork', () => {
    it('deletes the network when found', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(makeNetwork());

      await service.deleteNetwork('user-1', 'net-1');
      expect(mockRepo.deleteByIdAndUserId).toHaveBeenCalledWith('net-1', 'user-1');
    });

    it('throws NETWORK_002 when network does not exist', async () => {
      mockRepo.findByIdAndUserId.mockResolvedValue(null);
      await expect(service.deleteNetwork('user-1', 'missing')).rejects.toThrow(NodeScopeException);
      expect(mockRepo.deleteByIdAndUserId).not.toHaveBeenCalled();
    });
  });
});
