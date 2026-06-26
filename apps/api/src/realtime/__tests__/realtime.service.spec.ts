import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WS_EVENTS } from '@nodescope/shared';
import { RealtimeGateway } from '../realtime.gateway';
import { RedisService } from '../../redis/redis.service';
import { DataSourcesService } from '../../data-sources/data-sources.service';
import { NetworksService } from '../../networks/networks.service';
import { AiService } from '../../ai/ai.service';
import { OrganizationsRepository } from '../../organizations/organizations.repository';
import { PermissionsService } from '../../permissions/permissions.service';
import { PermissionsRepository } from '../../permissions/permissions.repository';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import { auth } from '../../auth/better-auth.config';

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

type MockNetworks = { checkOnHome: jest.Mock };

type MockOrgsRepo = { findMemberByUserId: jest.Mock };
type MockPermissionsService = { effectiveRoots: jest.Mock };
type MockPermissionsRepo = { findMember: jest.Mock; ancestorPropertyIds: jest.Mock };

describe('RealtimeGateway — service interface', () => {
  let gateway: RealtimeGateway;
  let mockDataSources: MockDataSources;
  let mockAiService: MockAi;
  let mockNetworks: MockNetworks;
  let mockOrgsRepo: MockOrgsRepo;
  let mockPermissionsService: MockPermissionsService;
  let mockPermissionsRepo: MockPermissionsRepo;

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

    mockNetworks = {
      checkOnHome: jest.fn().mockResolvedValue({ networkId: null, onHome: false }),
    };

    mockOrgsRepo = {
      findMemberByUserId: jest.fn().mockResolvedValue(null),
    };

    mockPermissionsService = {
      effectiveRoots: jest.fn().mockResolvedValue([]),
    };

    mockPermissionsRepo = {
      findMember: jest.fn().mockResolvedValue(null),
      ancestorPropertyIds: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: RedisService, useValue: mockRedis },
        { provide: DataSourcesService, useValue: mockDataSources },
        { provide: NetworksService, useValue: mockNetworks },
        { provide: AiService, useValue: mockAiService },
        { provide: OrganizationsRepository, useValue: mockOrgsRepo },
        { provide: PermissionsService, useValue: mockPermissionsService },
        { provide: PermissionsRepository, useValue: mockPermissionsRepo },
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
      const payload = { bandwidthDown: 100, bandwidthUp: 20, latency: 15, connectionQuality: 'good', timestamp: '2026-05-28T00:00:00.000Z' };
      gateway.pushToTier('PERSONAL_FREE', 'v1:metrics:update', payload);

      expect(mockServer.to).toHaveBeenCalledWith('tier:PERSONAL_FREE');
      expect(mockRoom.emit).toHaveBeenCalledWith('v1:metrics:update', payload);
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

  describe('recomputeOnHomeForUser', () => {
    it('iterates the user\'s sockets, recomputes onHome per-socket, and emits NETWORK_ON_HOME_CHANGED', async () => {
      const socket1 = {
        handshake: { address: '203.0.113.5' },
        data: {} as { onHome?: boolean },
        emit: jest.fn(),
      };
      const socket2 = {
        handshake: { address: '198.51.100.9' },
        data: {} as { onHome?: boolean },
        emit: jest.fn(),
      };
      const userRoom = { fetchSockets: jest.fn().mockResolvedValue([socket1, socket2]) };
      (mockServer as unknown as { in: jest.Mock }).in = jest.fn().mockReturnValue(userRoom);

      mockNetworks.checkOnHome
        .mockResolvedValueOnce({ networkId: 'net-1', onHome: true })
        .mockResolvedValueOnce({ networkId: 'net-1', onHome: false });

      await gateway.recomputeOnHomeForUser('user-1');

      expect((mockServer as unknown as { in: jest.Mock }).in).toHaveBeenCalledWith('user:user-1');
      expect(mockNetworks.checkOnHome).toHaveBeenCalledWith('user-1', '203.0.113.5');
      expect(mockNetworks.checkOnHome).toHaveBeenCalledWith('user-1', '198.51.100.9');
      expect(socket1.emit).toHaveBeenCalledWith(
        WS_EVENTS.NETWORK_ON_HOME_CHANGED,
        { networkId: 'net-1', onHome: true },
      );
      expect(socket2.emit).toHaveBeenCalledWith(
        WS_EVENTS.NETWORK_ON_HOME_CHANGED,
        { networkId: 'net-1', onHome: false },
      );
      expect(socket1.data.onHome).toBe(true);
      expect(socket2.data.onHome).toBe(false);
    });

    it('is a no-op when the user has no connected sockets', async () => {
      const userRoom = { fetchSockets: jest.fn().mockResolvedValue([]) };
      (mockServer as unknown as { in: jest.Mock }).in = jest.fn().mockReturnValue(userRoom);

      await gateway.recomputeOnHomeForUser('user-1');

      expect(mockNetworks.checkOnHome).not.toHaveBeenCalled();
    });
  });

  describe('runPushScheduler', () => {
    const run = () =>
      (gateway as unknown as { runPushScheduler: () => Promise<void> }).runPushScheduler();

    it('does not reject when the lock acquisition (redis.set) fails — logs and skips', async () => {
      const errorSpy = jest
        .spyOn((gateway as unknown as { logger: { error: jest.Mock } }).logger, 'error')
        .mockImplementation(() => undefined);
      mockRedis.set.mockRejectedValueOnce(new Error('redis down'));

      await expect(run()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
      expect(mockDataSources.getLatestMetrics).not.toHaveBeenCalled();
    });

    it('skips the cycle when the lock is not acquired (set → null)', async () => {
      mockRedis.set.mockResolvedValueOnce(null);
      await run();
      expect(mockDataSources.getLatestMetrics).not.toHaveBeenCalled();
    });

    it('runs the push cycle when the lock is acquired', async () => {
      mockRedis.set.mockResolvedValueOnce('OK');
      const fetchSockets = jest.fn().mockResolvedValue([]);
      (mockServer as unknown as { fetchSockets: jest.Mock }).fetchSockets = fetchSockets;

      await run();

      expect(fetchSockets).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleConnection', () => {
    const makeClientSocket = () => {
      const joinedRooms: string[] = [];
      return {
        data: {} as Record<string, unknown>,
        handshake: { headers: {}, address: '127.0.0.1' },
        join: jest.fn().mockImplementation((room: string) => {
          joinedRooms.push(room);
          return Promise.resolve();
        }),
        leave: jest.fn().mockResolvedValue(undefined),
        rooms: new Set<string>(),
        disconnect: jest.fn(),
        _joinedRooms: joinedRooms,
      } as unknown as Parameters<RealtimeGateway['handleConnection']>[0] & { _joinedRooms: string[] };
    };

    it('joins org:{orgId} room when user has an org membership', async () => {
      jest.spyOn(auth.api, 'getSession').mockResolvedValue({
        user: { id: 'u-1', tier: 'PERSONAL_FREE' },
        session: { id: 's-1', token: 'tok' },
      } as never);
      mockOrgsRepo.findMemberByUserId.mockResolvedValue({ organizationId: 'org-abc' });
      // permissionsRepo.findMember called after joining org room to cache effective roots
      mockPermissionsRepo.findMember.mockResolvedValue({ id: 'mem-1', role: 'MEMBER' });
      mockPermissionsService.effectiveRoots.mockResolvedValue(['prop-1']);

      const client = makeClientSocket();
      await gateway.handleConnection(client);

      const joined = client._joinedRooms;
      expect(joined).toContain('org:org-abc');
      expect(joined).toContain('user:u-1');
      expect(joined).toContain('tier:PERSONAL_FREE');
    });

    it('does NOT join any org room when user has no org membership', async () => {
      jest.spyOn(auth.api, 'getSession').mockResolvedValue({
        user: { id: 'u-2', tier: 'PERSONAL_FREE' },
        session: { id: 's-2', token: 'tok2' },
      } as never);
      mockOrgsRepo.findMemberByUserId.mockResolvedValue(null);
      mockPermissionsRepo.findMember.mockResolvedValue(null);

      const client = makeClientSocket();
      await gateway.handleConnection(client);

      const joined = client._joinedRooms;
      expect(joined.some((r) => r.startsWith('org:'))).toBe(false);
      expect(joined).toContain('user:u-2');
    });
  });

  describe('evictOrgMember', () => {
    const makeRemoteSocket = (orgId: string | null) => ({
      data: { orgId },
      disconnect: jest.fn(),
    });

    it('disconnects only the user sockets whose orgId matches the removed org', async () => {
      const match = makeRemoteSocket('org-1');
      const other = makeRemoteSocket('org-2'); // a different org (future multi-org) — left alone
      const fetchSockets = jest.fn().mockResolvedValue([match, other]);
      (mockServer as unknown as { in: jest.Mock }).in = jest.fn().mockReturnValue({ fetchSockets });

      await gateway.evictOrgMember('org-1', 'user-9');

      expect((mockServer as unknown as { in: jest.Mock }).in).toHaveBeenCalledWith('user:user-9');
      expect(match.disconnect).toHaveBeenCalledWith(true);
      expect(other.disconnect).not.toHaveBeenCalled();
    });

    it('is a no-op when the user has no connected sockets', async () => {
      const fetchSockets = jest.fn().mockResolvedValue([]);
      (mockServer as unknown as { in: jest.Mock }).in = jest.fn().mockReturnValue({ fetchSockets });

      await expect(gateway.evictOrgMember('org-1', 'user-9')).resolves.toBeUndefined();
    });
  });

  describe('onResync', () => {
    const makeLocalSocket = (orgId: string | null, rooms: string[]) => {
      const roomSet = new Set<string>(rooms);
      return {
        data: { orgId, user: { id: 'u-1' } } as Record<string, unknown>,
        rooms: roomSet,
        join: jest.fn().mockImplementation((r: string) => { roomSet.add(r); return Promise.resolve(); }),
        leave: jest.fn().mockImplementation((r: string) => { roomSet.delete(r); return Promise.resolve(); }),
      } as unknown as Parameters<RealtimeGateway['onResync']>[0];
    };

    it('clears roots but retains the org room/orgId when findMember returns null', async () => {
      // A null read must NOT be treated as eviction here — that is removeMember's job
      // (force-disconnect). A transient DB null must not durably drop a valid member.
      mockPermissionsRepo.findMember.mockResolvedValue(null);
      const client = makeLocalSocket('org-1', ['org:org-1', 'scope:p-1', 'user:u-1']);

      await gateway.onResync(client);

      expect(client.leave).toHaveBeenCalledWith('scope:p-1'); // scope rooms re-derived (now none)
      expect(client.leave).not.toHaveBeenCalledWith('org:org-1'); // org room retained
      expect((client.data as { orgId: unknown }).orgId).toBe('org-1'); // orgId retained
      expect((client.data as { effectiveRoots: unknown }).effectiveRoots).toEqual([]);
      expect(mockPermissionsService.effectiveRoots).not.toHaveBeenCalled();
    });

    it('re-syncs scope rooms for a still-scoped member', async () => {
      mockPermissionsRepo.findMember.mockResolvedValue({ id: 'mem-1', role: 'MEMBER' });
      mockPermissionsService.effectiveRoots.mockResolvedValue(['p-2']);
      const client = makeLocalSocket('org-1', ['org:org-1', 'scope:p-1']);

      await gateway.onResync(client);

      expect(client.leave).toHaveBeenCalledWith('scope:p-1'); // stale root dropped
      expect(client.join).toHaveBeenCalledWith('scope:p-2');  // new root joined
      expect(client.leave).not.toHaveBeenCalledWith('org:org-1'); // org room retained
      expect((client.data as { orgId: unknown }).orgId).toBe('org-1');
    });
  });

  describe('handlePing', () => {
    it('returns PONG event with null data', () => {
      const response = gateway.handlePing();
      expect(response).toEqual({ event: WS_EVENTS.PONG, data: null });
    });
  });

  describe('handleMetricsSubmit', () => {
    const buildSocket = (user?: { id: string }, orgId?: string | null) =>
      ({ data: { user, orgId: orgId ?? null } }) as unknown as Parameters<RealtimeGateway['handleMetricsSubmit']>[0];

    it('ingests using orgId and userId from socket.data, never from payload', async () => {
      const socket = buildSocket({ id: 'authenticated-user' }, 'org-abc');
      // Attacker-controlled payload tries to spoof userId — must be ignored
      const payload = {
        bandwidthDown: 100,
        bandwidthUp: 50,
        latency: 30,
        userId: 'victim-user',
      } as unknown as Parameters<RealtimeGateway['handleMetricsSubmit']>[1];

      await gateway.handleMetricsSubmit(socket, payload);

      expect(mockDataSources.ingest).toHaveBeenCalledWith(
        'org-abc',
        'authenticated-user',
        expect.objectContaining({ bandwidthDown: 100, bandwidthUp: 50, latency: 30 }),
      );
      expect(mockDataSources.ingest).not.toHaveBeenCalledWith(
        expect.anything(),
        'victim-user',
        expect.anything(),
      );
    });

    it('returns silently when socket has no authenticated user', async () => {
      const socket = buildSocket(undefined, 'org-abc');
      await gateway.handleMetricsSubmit(socket, { bandwidthDown: 100 });
      expect(mockDataSources.ingest).not.toHaveBeenCalled();
    });

    it('returns silently when socket has no orgId (user not yet in an org)', async () => {
      const socket = buildSocket({ id: 'user-1' }, null);
      await gateway.handleMetricsSubmit(socket, { bandwidthDown: 100 });
      expect(mockDataSources.ingest).not.toHaveBeenCalled();
    });

    it('ingests metrics payload directly (browser device resolution removed in F2B)', async () => {
      const socket = buildSocket({ id: 'user-1' }, 'org-abc');

      await gateway.handleMetricsSubmit(socket, { bandwidthDown: 100 });

      expect(mockDataSources.ingest).toHaveBeenCalledWith(
        'org-abc',
        'user-1',
        expect.objectContaining({ bandwidthDown: 100 }),
      );
    });

    it('passes tag from payload through to ingest', async () => {
      const socket = buildSocket({ id: 'user-1' }, 'org-abc');

      await gateway.handleMetricsSubmit(socket, {
        tag: 'speedtest',
        bandwidthDown: 100,
      } as unknown as Parameters<RealtimeGateway['handleMetricsSubmit']>[1]);

      expect(mockDataSources.ingest).toHaveBeenCalledWith(
        'org-abc',
        'user-1',
        expect.objectContaining({ tag: 'speedtest' }),
      );
    });
  });

  describe('handleAiMessage', () => {
    const buildSocket = (
      user?: { id: string; tier: string },
      address = '10.0.0.5',
      orgId: string | null = 'org-ai-test',
    ) =>
      ({
        data: { user, orgId },
        handshake: { address },
      }) as unknown as Parameters<RealtimeGateway['handleAiMessage']>[0];

    it('emits AI_TOKEN per token and AI_COMPLETE on success', async () => {
      mockAiService.sendMessageStream.mockImplementation(async (_org, _uid, _tier, _ip, _dto, onToken) => {
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
        'org-ai-test',
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
        data: { user: { id: 'u-1', tier: 'PERSONAL_FREE' }, orgId: 'org-ai-test' },
        handshake: {}, // intentionally no address
      } as unknown as Parameters<RealtimeGateway['handleAiMessage']>[0];
      await gateway.handleAiMessage(socket, { content: 'hi' });

      expect(mockAiService.sendMessageStream).toHaveBeenCalledWith(
        'org-ai-test',
        'u-1',
        'PERSONAL_FREE',
        '0.0.0.0',
        expect.any(Object),
        expect.any(Function),
      );
    });
  });
});
