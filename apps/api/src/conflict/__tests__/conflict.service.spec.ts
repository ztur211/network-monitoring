import { Test, TestingModule } from '@nestjs/testing';
import { ConflictResolutionService } from '../conflict.service';
import { RedisService } from '../../redis/redis.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import { ChangesetDto } from '@nodescope/shared';

const mockRedis = { publish: jest.fn() };

describe('ConflictResolutionService', () => {
  let service: ConflictResolutionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConflictResolutionService,
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<ConflictResolutionService>(ConflictResolutionService);
    jest.clearAllMocks();
  });

  describe('buildUpdatePayload', () => {
    const writableFields = ['name', 'notes'] as const;

    it('returns update payload for valid changeset', () => {
      const changeset: ChangesetDto = {
        baseVersion: 1,
        changes: [{ field: 'name', oldValue: 'Old', newValue: 'New' }],
      };
      const result = service.buildUpdatePayload(changeset, writableFields, 1);
      expect(result).toEqual({ name: 'New' });
    });

    it('builds payload with multiple changes', () => {
      const changeset: ChangesetDto = {
        baseVersion: 1,
        changes: [
          { field: 'name', oldValue: 'Old', newValue: 'New' },
          { field: 'notes', oldValue: null, newValue: 'Added notes' },
        ],
      };
      const result = service.buildUpdatePayload(changeset, writableFields, 1);
      expect(result).toEqual({ name: 'New', notes: 'Added notes' });
    });

    it('throws SYNC_001 NodeScopeException when baseVersion does not match', () => {
      const changeset: ChangesetDto = {
        baseVersion: 2,
        changes: [{ field: 'name', oldValue: 'Old', newValue: 'New' }],
      };
      expect(() => service.buildUpdatePayload(changeset, writableFields, 1)).toThrow(NodeScopeException);
    });

    it('throws GEN_001 NodeScopeException when field is not writable', () => {
      const changeset: ChangesetDto = {
        baseVersion: 1,
        changes: [{ field: 'id', oldValue: '1', newValue: '2' }],
      };
      expect(() => service.buildUpdatePayload(changeset, writableFields, 1)).toThrow(NodeScopeException);
    });
  });

  describe('publishEntityUpdate', () => {
    it('publishes serialized event to nodescope:entity:updated channel', async () => {
      mockRedis.publish.mockResolvedValue(1);

      await service.publishEntityUpdate('Device', 'device-1', 'user-1');

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'nodescope:entity:updated',
        expect.stringContaining('"entityType":"Device"'),
      );
      const payload = JSON.parse(mockRedis.publish.mock.calls[0][1] as string);
      expect(payload).toMatchObject({ entityType: 'Device', entityId: 'device-1', userId: 'user-1' });
    });
  });
});
