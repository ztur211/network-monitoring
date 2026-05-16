import { Test, TestingModule } from '@nestjs/testing';
import { RealtimeGateway } from '../realtime.gateway';
import { RedisService } from '../../redis/redis.service';
import { DataSourcesService } from '../../data-sources/data-sources.service';
import { AiService } from '../../ai/ai.service';

const mockRoom = { emit: jest.fn() };
const mockServer = {
  to: jest.fn().mockReturnValue(mockRoom),
};

const mockRedis = {
  sadd: jest.fn().mockResolvedValue(1),
  srem: jest.fn().mockResolvedValue(1),
  scard: jest.fn().mockResolvedValue(0),
  set: jest.fn().mockResolvedValue(null),
  duplicate: jest.fn().mockReturnValue({
    on: jest.fn(),
    subscribe: jest.fn().mockResolvedValue(undefined),
  }),
  publish: jest.fn().mockResolvedValue(0),
};

describe('RealtimeGateway — service interface', () => {
  let gateway: RealtimeGateway;

  beforeEach(async () => {
    const mockDataSources = {
      ingest: jest.fn(),
      getLatestMetric: jest.fn(),
      getLatestMetrics: jest.fn().mockResolvedValue(new Map()),
      getDataSourceStatus: jest.fn(),
    };

    const mockAiService = {
      sendMessageStream: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: RedisService, useValue: mockRedis },
        { provide: DataSourcesService, useValue: mockDataSources },
        { provide: AiService, useValue: mockAiService },
      ],
    }).compile();

    gateway = module.get<RealtimeGateway>(RealtimeGateway);
    (gateway as unknown as { server: typeof mockServer }).server = mockServer;
  });

  afterEach(() => jest.clearAllMocks());

  describe('pushToUser', () => {
    it('emits to user:{userId} room', () => {
      gateway.pushToUser('user-abc', 'v1:device:updated', { deviceId: 'd1' });

      expect(mockServer.to).toHaveBeenCalledWith('user:user-abc');
      expect(mockRoom.emit).toHaveBeenCalledWith('v1:device:updated', { deviceId: 'd1' });
    });
  });

  describe('pushToTier', () => {
    it('emits to tier:{tier} room', () => {
      gateway.pushToTier('PERSONAL_FREE', 'v1:connection:status', { status: 'connected', message: null });

      expect(mockServer.to).toHaveBeenCalledWith('tier:PERSONAL_FREE');
      expect(mockRoom.emit).toHaveBeenCalledWith('v1:connection:status', {
        status: 'connected',
        message: null,
      });
    });
  });

  describe('pushToOrg', () => {
    it('emits to org:{orgId} room', () => {
      gateway.pushToOrg('org-xyz', 'v1:error', { code: 'GEN_003', message: 'error', context: null });

      expect(mockServer.to).toHaveBeenCalledWith('org:org-xyz');
      expect(mockRoom.emit).toHaveBeenCalledWith('v1:error', {
        code: 'GEN_003',
        message: 'error',
        context: null,
      });
    });
  });

  describe('getConnectionStatus', () => {
    it('returns connected when active socket count > 0', async () => {
      mockRedis.scard.mockResolvedValueOnce(2);

      const status = await gateway.getConnectionStatus('user-abc');

      expect(status).toBe('connected');
      expect(mockRedis.scard).toHaveBeenCalledWith('nodescope:connections:user-abc');
    });

    it('returns offline when active socket count is 0', async () => {
      mockRedis.scard.mockResolvedValueOnce(0);

      const status = await gateway.getConnectionStatus('user-abc');

      expect(status).toBe('offline');
    });
  });
});
