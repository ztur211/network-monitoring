import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { RealtimeModule } from '../realtime.module';
import { RedisService } from '../../redis/redis.service';
import { WS_EVENTS } from '@nodescope/shared';

jest.mock('@socket.io/redis-adapter', () => ({
  createAdapter: jest.fn().mockReturnValue(() => ({ rooms: new Map() })),
}));

jest.mock('../../auth/better-auth.config', () => ({
  auth: {
    api: {
      getSession: jest.fn(),
    },
  },
}));

import { auth } from '../../auth/better-auth.config';

const VALID_SESSION = {
  user: { id: 'test-user-1', email: 'test@example.com', tier: 'PERSONAL_FREE' },
  session: { id: 'session-1', token: 'tok' },
};

const mockRedis = {
  sadd: jest.fn().mockResolvedValue(1),
  srem: jest.fn().mockResolvedValue(1),
  scard: jest.fn().mockResolvedValue(1),
  set: jest.fn().mockResolvedValue('OK'),
  duplicate: jest.fn().mockReturnValue({
    on: jest.fn(),
    subscribe: jest.fn(),
  }),
};

describe('RealtimeGateway (e2e)', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [RealtimeModule],
    })
      .overrideProvider(RedisService)
      .useValue(mockRedis)
      .compile();

    app = module.createNestApplication();
    await app.init();

    const httpServer = app.getHttpServer() as import('http').Server;
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as { port: number }).port;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('connection with valid session', () => {
    it('connects and Redis records the socket', (done) => {
      (auth.api.getSession as jest.Mock).mockResolvedValue(VALID_SESSION);

      const client: ClientSocket = io(`http://localhost:${port}`, {
        withCredentials: false,
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });

      client.on('connect', () => {
        expect(client.connected).toBe(true);
        expect(mockRedis.sadd).toHaveBeenCalledWith(
          'nodescope:connections:test-user-1',
          expect.any(String),
        );
        client.disconnect();
        done();
      });

      client.on('connect_error', (err) => {
        client.disconnect();
        done(err);
      });
    });
  });

  describe('connection with missing/invalid session', () => {
    it('is rejected — socket disconnects immediately', (done) => {
      (auth.api.getSession as jest.Mock).mockResolvedValue(null);

      const client: ClientSocket = io(`http://localhost:${port}`, {
        withCredentials: false,
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });

      client.on('disconnect', () => {
        expect(client.connected).toBe(false);
        done();
      });

      client.on('connect_error', () => {
        done();
      });
    });
  });

  describe('v1:ping → v1:pong heartbeat', () => {
    it('responds to ping with pong', (done) => {
      (auth.api.getSession as jest.Mock).mockResolvedValue(VALID_SESSION);

      const client: ClientSocket = io(`http://localhost:${port}`, {
        withCredentials: false,
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });

      client.on('connect', () => {
        client.emit(WS_EVENTS.PING);
      });

      client.on(WS_EVENTS.PONG, () => {
        client.disconnect();
        done();
      });

      client.on('connect_error', (err) => {
        client.disconnect();
        done(err);
      });
    });
  });

  describe('disconnect', () => {
    it('removes the socket from Redis on disconnect', (done) => {
      (auth.api.getSession as jest.Mock).mockResolvedValue(VALID_SESSION);

      const client: ClientSocket = io(`http://localhost:${port}`, {
        withCredentials: false,
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });

      client.on('connect', () => {
        const socketId = client.id!;
        client.disconnect();

        setTimeout(() => {
          expect(mockRedis.srem).toHaveBeenCalledWith(
            'nodescope:connections:test-user-1',
            socketId,
          );
          done();
        }, 100);
      });
    });
  });
});
