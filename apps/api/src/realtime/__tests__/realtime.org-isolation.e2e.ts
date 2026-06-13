/**
 * Org-isolation test: entity events emitted via pushToOrg(orgId, …) must target
 * only the org's room — NOT another org's room, and NOT a per-user room.
 *
 * Strategy: rather than a flaky two-client timing test we spy on the Socket.io
 * server's `to(room)` chain at the gateway level.  We boot the full NestJS app
 * (RealtimeModule + AuditModule), grab the RealtimeGateway instance, swap its
 * internal `server` field with a spy-wrapped version, then call `pushToOrg`
 * directly and assert the correct room was targeted while the wrong rooms were
 * not.
 */

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RealtimeModule } from '../realtime.module';
import { AuditModule } from '../../audit/audit.module';
import { ConfigModule } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { OrganizationsRepository } from '../../organizations/organizations.repository';
import { RealtimeGateway } from '../realtime.gateway';
import { WS_EVENTS } from '@nodescope/shared';

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
  scard: jest.fn().mockResolvedValue(0),
  set: jest.fn().mockResolvedValue('OK'),
  duplicate: jest.fn().mockImplementation(makePubSubClient),
};

describe('RealtimeGateway — org isolation (e2e)', () => {
  let app: INestApplication;
  let gateway: RealtimeGateway;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [RealtimeModule, AuditModule, ConfigModule.forRoot({ isGlobal: true })],
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

    gateway = module.get<RealtimeGateway>(RealtimeGateway);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('pushToOrg targets only the org room — not a different org room and not a user room', () => {
    // Spy on the internal server.to chain inside the gateway
    const emitSpy = jest.fn();
    const toSpy = jest.fn().mockReturnValue({ emit: emitSpy });

    // Access the gateway's private server field
    const gw = gateway as unknown as { server: { to: jest.Mock } };
    const originalServer = gw.server;
    gw.server = { to: toSpy };

    try {
      gateway.pushToOrg('orgA', WS_EVENTS.DEVICE_UPDATED, { deviceId: 'd1' });

      // Must have targeted org:orgA
      expect(toSpy).toHaveBeenCalledWith('org:orgA');
      expect(emitSpy).toHaveBeenCalledWith(
        WS_EVENTS.DEVICE_UPDATED,
        expect.objectContaining({ deviceId: 'd1' }),
      );

      // Must NOT have targeted org:orgB or any user: room
      const targetedRooms: string[] = toSpy.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(targetedRooms.some((r) => r === 'org:orgB')).toBe(false);
      expect(targetedRooms.some((r) => r.startsWith('user:'))).toBe(false);
    } finally {
      gw.server = originalServer;
    }
  });

  it('pushToOrg for org B does NOT reach the org A room', () => {
    const emitSpy = jest.fn();
    const toSpy = jest.fn().mockReturnValue({ emit: emitSpy });

    const gw = gateway as unknown as { server: { to: jest.Mock } };
    const originalServer = gw.server;
    gw.server = { to: toSpy };

    try {
      // Simulate a mutation in org B
      gateway.pushToOrg('orgB', WS_EVENTS.DEVICE_UPDATED, { deviceId: 'd2' });

      const targetedRooms: string[] = toSpy.mock.calls.map((c: unknown[]) => c[0] as string);

      // org:orgB was targeted
      expect(targetedRooms).toContain('org:orgB');

      // org:orgA was NOT targeted — org A clients are isolated
      expect(targetedRooms).not.toContain('org:orgA');
    } finally {
      gw.server = originalServer;
    }
  });

  it('pushToUser for AI events does NOT target any org room — per-user AI stays per-user', () => {
    const emitSpy = jest.fn();
    const toSpy = jest.fn().mockReturnValue({ emit: emitSpy });

    const gw = gateway as unknown as { server: { to: jest.Mock } };
    const originalServer = gw.server;
    gw.server = { to: toSpy };

    try {
      gateway.pushToUser('user-1', WS_EVENTS.AI_COMPLETE, { content: 'hello' });

      const targetedRooms: string[] = toSpy.mock.calls.map((c: unknown[]) => c[0] as string);

      // Only user:user-1 was targeted
      expect(targetedRooms).toContain('user:user-1');
      expect(targetedRooms.some((r) => r.startsWith('org:'))).toBe(false);
    } finally {
      gw.server = originalServer;
    }
  });
});
