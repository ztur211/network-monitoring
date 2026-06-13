import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { RealtimeModule } from '../realtime.module';
import { RedisService } from '../../redis/redis.service';
import { OrganizationsRepository } from '../../organizations/organizations.repository';
import { WS_EVENTS } from '@nodescope/shared';
import { auth } from '../../auth/better-auth.config';

const VALID_SESSION = {
  user: { id: 'test-user-1', email: 'test@example.com', tier: 'PERSONAL_FREE' },
  session: { id: 'session-1', token: 'tok' },
};

// The Redis adapter calls pub/sub methods on each duplicated client. Provide
// no-op stubs so adapter init doesn't crash — pub/sub propagation is not
// exercised by these connection-flow tests.
function makePubSubClient(): Record<string, jest.Mock> {
  const client: Record<string, jest.Mock> = {};
  for (const method of [
    'on', 'subscribe', 'psubscribe', 'unsubscribe', 'punsubscribe',
    'publish', 'spublish', 'ssubscribe', 'sunsubscribe', 'quit',
  ]) {
    client[method] = jest.fn();
  }
  client.duplicate = jest.fn().mockImplementation(makePubSubClient);
  return client;
}

const mockRedis = {
  sadd: jest.fn().mockResolvedValue(1),
  srem: jest.fn().mockResolvedValue(1),
  scard: jest.fn().mockResolvedValue(1),
  set: jest.fn().mockResolvedValue('OK'),
  duplicate: jest.fn().mockImplementation(makePubSubClient),
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
      .overrideProvider(OrganizationsRepository)
      .useValue({ findMemberByUserId: jest.fn().mockResolvedValue(null) })
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
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('connection with valid session', () => {
    it('connects and Redis records the socket', (done) => {
      jest.spyOn(auth.api, 'getSession').mockResolvedValue(VALID_SESSION as never);

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
      jest.spyOn(auth.api, 'getSession').mockResolvedValue(null as never);

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
      jest.spyOn(auth.api, 'getSession').mockResolvedValue(VALID_SESSION as never);

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
      jest.spyOn(auth.api, 'getSession').mockResolvedValue(VALID_SESSION as never);

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
