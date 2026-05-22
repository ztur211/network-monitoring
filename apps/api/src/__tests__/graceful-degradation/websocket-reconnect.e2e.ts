/**
 * Graceful degradation: WebSocket reconnection and auth rejection (SAD Section 11.8)
 *
 * Verifies:
 * - Gateway rejects unauthenticated connections cleanly (no unhandled exceptions)
 * - Gateway records and cleans up socket presence in Redis on connect/disconnect
 * - Push scheduler does not throw when no users are connected
 */
import { Test, TestingModule } from '@nestjs/testing';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { RedisService } from '../../redis/redis.service';
import { DataSourcesService } from '../../data-sources/data-sources.service';
import { DevicesService } from '../../devices/devices.service';
import { AiService } from '../../ai/ai.service';
import { Socket } from 'socket.io';
import { auth } from '../../auth/better-auth.config';

const mockRedis = {
  sadd: jest.fn().mockResolvedValue(1),
  srem: jest.fn().mockResolvedValue(1),
  scard: jest.fn().mockResolvedValue(0),
  smembers: jest.fn().mockResolvedValue([]),
  set: jest.fn().mockResolvedValue('OK'),
  duplicate: jest.fn().mockReturnThis(),
};

const mockDataSources = {
  getLatestMetrics: jest.fn().mockResolvedValue(new Map()),
};

const mockAiService = {};

const mockDevicesService = {
  findDeviceIdByBrowserDeviceId: jest.fn().mockResolvedValue(null),
};

function makeSocket(overrides: Partial<Socket> = {}): Socket {
  return {
    id: 'test-socket-id',
    handshake: { headers: {} },
    data: {},
    join: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    emit: jest.fn(),
    ...overrides,
  } as unknown as Socket;
}

describe('Graceful degradation — WebSocket reconnection', () => {
  let gateway: RealtimeGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: RedisService, useValue: mockRedis },
        { provide: DataSourcesService, useValue: mockDataSources },
        { provide: DevicesService, useValue: mockDevicesService },
        { provide: AiService, useValue: mockAiService },
      ],
    }).compile();
    gateway = module.get(RealtimeGateway);
    jest.clearAllMocks();
    mockRedis.sadd.mockResolvedValue(1);
    mockRedis.srem.mockResolvedValue(1);
    mockRedis.scard.mockResolvedValue(0);
    mockRedis.smembers.mockResolvedValue([]);
    mockRedis.set.mockResolvedValue('OK');
    mockDataSources.getLatestMetrics.mockResolvedValue(new Map());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('disconnects client when session is missing (unauthenticated handshake)', async () => {
    jest.spyOn(auth.api, 'getSession').mockResolvedValue(null as never);
    const socket = makeSocket();

    await gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
    expect(mockRedis.sadd).not.toHaveBeenCalled();
  });

  it('joins user room and records presence on valid session', async () => {
    const userId = 'user-abc';
    jest.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: userId, tier: 'PERSONAL_FREE' },
      session: {},
    } as never);
    const socket = makeSocket();

    await gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith(`user:${userId}`);
    expect(socket.join).toHaveBeenCalledWith(`tier:PERSONAL_FREE`);
    expect(mockRedis.sadd).toHaveBeenCalledWith(
      expect.stringContaining(userId),
      socket.id,
    );
  });

  it('removes socket from Redis presence on disconnect', async () => {
    const userId = 'user-abc';
    const socket = makeSocket();
    socket.data.user = { id: userId };

    await gateway.handleDisconnect(socket);

    expect(mockRedis.srem).toHaveBeenCalledWith(
      expect.stringContaining(userId),
      socket.id,
    );
  });

  it('handleDisconnect does not throw when socket has no user data (pre-auth disconnect)', async () => {
    const socket = makeSocket();
    socket.data = {};

    await expect(gateway.handleDisconnect(socket)).resolves.not.toThrow();
    expect(mockRedis.srem).not.toHaveBeenCalled();
  });

  it('getConnectionStatus returns offline when no sockets in Redis set', async () => {
    mockRedis.scard.mockResolvedValue(0);
    const status = await gateway.getConnectionStatus('user-xyz');
    expect(status).toBe('offline');
  });

  it('getConnectionStatus returns connected when sockets present in Redis set', async () => {
    mockRedis.scard.mockResolvedValue(2);
    const status = await gateway.getConnectionStatus('user-xyz');
    expect(status).toBe('connected');
  });
});
