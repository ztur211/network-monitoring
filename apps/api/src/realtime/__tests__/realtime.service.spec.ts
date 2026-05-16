import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WS_EVENTS } from '@nodescope/shared';
import { RealtimeGateway } from '../realtime.gateway';
import { RedisService } from '../../redis/redis.service';
import { DataSourcesService } from '../../data-sources/data-sources.service';
import { AiService } from '../../ai/ai.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

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

type MockDataSources = {
  ingest: jest.Mock;
  getLatestMetric: jest.Mock;
  getLatestMetrics: jest.Mock;
  getDataSourceStatus: jest.Mock;
};

type MockAi = { sendMessageStream: jest.Mock };

describe('RealtimeGateway — service interface', () => {
  let gateway: RealtimeGateway;
  let mockDataSources: MockDataSources;
  let mockAiService: MockAi;

  beforeEach(async () => {
    mockDataSources = {
      ingest: jest.fn(),
      getLatestMetric: jest.fn(),
      getLatestMetrics: jest.fn().mockResolvedValue(new Map()),
      getDataSourceStatus: jest.fn(),
    };

    mockAiService = {
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

  describe('handlePing', () => {
    it('returns PONG event with null data', () => {
      const response = gateway.handlePing();
      expect(response).toEqual({ event: WS_EVENTS.PONG, data: null });
    });
  });

  describe('handleMetricsSubmit', () => {
    const buildSocket = (user?: { id: string }) =>
      ({ data: { user } }) as unknown as Parameters<RealtimeGateway['handleMetricsSubmit']>[0];

    it('ingests using userId from socket.data, never from payload', async () => {
      const socket = buildSocket({ id: 'authenticated-user' });
      // Attacker-controlled payload tries to spoof userId — must be ignored
      const payload = {
        bandwidthDown: 100,
        bandwidthUp: 50,
        latency: 30,
        userId: 'victim-user',
      } as unknown as Parameters<RealtimeGateway['handleMetricsSubmit']>[1];

      await gateway.handleMetricsSubmit(socket, payload);

      expect(mockDataSources.ingest).toHaveBeenCalledWith('authenticated-user', payload);
      expect(mockDataSources.ingest).not.toHaveBeenCalledWith('victim-user', expect.anything());
    });

    it('returns silently when socket has no authenticated user', async () => {
      const socket = buildSocket(undefined);
      await gateway.handleMetricsSubmit(socket, { bandwidthDown: 100 });
      expect(mockDataSources.ingest).not.toHaveBeenCalled();
    });
  });

  describe('handleAiMessage', () => {
    const buildSocket = (
      user?: { id: string; tier: string },
      address = '10.0.0.5',
    ) =>
      ({
        data: { user },
        handshake: { address },
      }) as unknown as Parameters<RealtimeGateway['handleAiMessage']>[0];

    it('emits AI_TOKEN per token and AI_COMPLETE on success', async () => {
      mockAiService.sendMessageStream.mockImplementation(async (_uid, _tier, _ip, _dto, onToken) => {
        onToken('hello', 'conv-1');
        onToken(' world', 'conv-1');
        return {
          content: 'hello world',
          conversationId: 'conv-1',
          tokensUsed: 25,
          monthlyBudgetRemaining: 9000,
          usageWarning: null,
          providerStatus: 'ok',
        };
      });

      const socket = buildSocket({ id: 'u-1', tier: 'PERSONAL_FREE' });
      await gateway.handleAiMessage(socket, { content: 'hi' });

      expect(mockAiService.sendMessageStream).toHaveBeenCalledWith(
        'u-1',
        'PERSONAL_FREE',
        '10.0.0.5',
        expect.objectContaining({ content: 'hi' }),
        expect.any(Function),
      );
      expect(mockServer.to).toHaveBeenCalledWith('user:u-1');
      expect(mockRoom.emit).toHaveBeenCalledWith(WS_EVENTS.AI_TOKEN, { token: 'hello', conversationId: 'conv-1' });
      expect(mockRoom.emit).toHaveBeenCalledWith(WS_EVENTS.AI_TOKEN, { token: ' world', conversationId: 'conv-1' });
      expect(mockRoom.emit).toHaveBeenCalledWith(
        WS_EVENTS.AI_COMPLETE,
        expect.objectContaining({
          content: 'hello world',
          conversationId: 'conv-1',
          providerStatus: 'ok',
          timestamp: expect.any(String),
        }),
      );
    });

    it('emits ERROR with NodeScopeException code when rate limit fires', async () => {
      mockAiService.sendMessageStream.mockRejectedValue(
        new NodeScopeException('AI_001', 'AI_RATE_LIMIT_HOURLY', HttpStatus.TOO_MANY_REQUESTS),
      );

      const socket = buildSocket({ id: 'u-1', tier: 'PERSONAL_FREE' });
      await gateway.handleAiMessage(socket, { content: 'hi' });

      expect(mockRoom.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'AI_001', context: 'ai' }),
      );
      expect(mockRoom.emit).not.toHaveBeenCalledWith(WS_EVENTS.AI_COMPLETE, expect.anything());
    });

    it('emits ERROR with GEN_003 on unexpected error', async () => {
      mockAiService.sendMessageStream.mockRejectedValue(new Error('unexpected boom'));

      const socket = buildSocket({ id: 'u-1', tier: 'PERSONAL_FREE' });
      await gateway.handleAiMessage(socket, { content: 'hi' });

      expect(mockRoom.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'GEN_003', context: 'ai' }),
      );
    });

    it('returns silently when socket has no authenticated user', async () => {
      const socket = buildSocket(undefined);
      await gateway.handleAiMessage(socket, { content: 'hi' });
      expect(mockAiService.sendMessageStream).not.toHaveBeenCalled();
      expect(mockRoom.emit).not.toHaveBeenCalled();
    });

    it('returns silently when content is empty after trim', async () => {
      const socket = buildSocket({ id: 'u-1', tier: 'PERSONAL_FREE' });
      await gateway.handleAiMessage(socket, { content: '   ' });
      expect(mockAiService.sendMessageStream).not.toHaveBeenCalled();
    });

    it('returns silently when content exceeds 2000 chars', async () => {
      const socket = buildSocket({ id: 'u-1', tier: 'PERSONAL_FREE' });
      await gateway.handleAiMessage(socket, { content: 'x'.repeat(2001) });
      expect(mockAiService.sendMessageStream).not.toHaveBeenCalled();
    });

    it('uses fallback ip when handshake.address is undefined', async () => {
      mockAiService.sendMessageStream.mockResolvedValue({
        content: 'ok', conversationId: 'c', tokensUsed: 1, monthlyBudgetRemaining: 1,
        usageWarning: null, providerStatus: 'ok',
      });

      const socket = {
        data: { user: { id: 'u-1', tier: 'PERSONAL_FREE' } },
        handshake: {}, // intentionally no address
      } as unknown as Parameters<RealtimeGateway['handleAiMessage']>[0];
      await gateway.handleAiMessage(socket, { content: 'hi' });

      expect(mockAiService.sendMessageStream).toHaveBeenCalledWith(
        'u-1',
        'PERSONAL_FREE',
        '0.0.0.0',
        expect.any(Object),
        expect.any(Function),
      );
    });
  });
});
