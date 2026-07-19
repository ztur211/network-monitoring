import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsResponse,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { fromNodeHeaders } from 'better-auth/node';
import { Server, Socket } from 'socket.io';
import { auth } from '../auth/better-auth.config';
import { mapLimit, nonOverlapping } from '@nodescope/shared';
import { envInt } from '../config/env';
import { RedisService } from '../redis/redis.service';
import { DataSourcesService } from '../data-sources/data-sources.service';
import { NetworksService } from '../networks/networks.service';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { PermissionsService } from '../permissions/permissions.service';
import { PermissionsRepository } from '../permissions/permissions.repository';
import { AiService } from '../ai/ai.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { AccountTier, ConnectionStatus, MetricsDto, WS_EVENTS } from '@nodescope/shared';
import {
  IRealtimeService,
  REDIS_KEY_CONN_ORG,
  REDIS_KEY_PUSH_SCHEDULER_LOCK,
} from './realtime.types';
import {
  REDIS_KEY_SOCKET_PRESENCE,
  encodeSocketPresence,
  partitionSocketPresence,
  type LiveSocketPresence,
} from './socket-presence';

interface MetricsSubmitPayload {
  bandwidthDown?: number;
  bandwidthUp?: number;
  latency?: number;
  connectionQuality?: string;
  tag?: string;
}

/**
 * Orgs whose latest-metrics query may be in flight at once during a push. Deliberately small:
 * the Prisma pool is shared with every HTTP handler, so a wide push would starve the API.
 */
const PUSH_ORG_CONCURRENCY = 4;
const PRESENCE_DELETE_BATCH_SIZE = 500;

/**
 * Per-user fixed-window rate limit for metrics:submit (see handleMetricsSubmit). The global
 * @nestjs/throttler ThrottlerGuard only inspects context.switchToHttp(), so it provides NO
 * limit for @SubscribeMessage handlers - an authenticated socket could otherwise emit
 * metrics:submit as fast as it can write, driving unbounded INSERTs into the DeviceMetric
 * TimescaleDB hypertable (a client-driven disk/DB-growth runaway).
 *
 * The legitimate browser collector emits one submission per COLLECT_INTERVAL_MS (30s) per open
 * tab - 2/min for a single tab (apps/web/lib/browser-collector.service.ts). A 60/min cap gives
 * ~30x headroom over one tab and comfortably covers a user with several tabs/devices open at
 * once, while capping a flooding client to a flat 60 INSERTs/min instead of an unbounded stream.
 * Overridable so an operator can tighten or loosen it without a code change (mirrors the AI
 * rate limiter's env-configurable caps).
 */
const WS_METRICS_WINDOW_SECONDS = 60;
export const WS_METRICS_MAX_PER_WINDOW = envInt('WS_METRICS_RATE_LIMIT', 60, { min: 1 });

/** Minute-resolution window tag, e.g. '2026-07-14T12:34'. */
function currentMinuteTag(): string {
  return new Date().toISOString().slice(0, 16);
}

/**
 * Per-user, minute-bucketed counter key. The minute tag lives in the key so the window
 * self-rolls at the boundary (a fresh key => a fresh count), mirroring the AI rate limiter's
 * `ai:rate:hourly:<user>:<tag>` scheme.
 */
function metricsRateKey(userId: string): string {
  return `ws:metrics:${userId}:${currentMinuteTag()}`;
}

/**
 * Drives BOTH the push-scheduler tick and the lock TTL, so they can never disagree. Read
 * through envInt: an empty or malformed REFRESH_INTERVAL_SECONDS previously became NaN, and
 * setInterval(fn, NaN) silently means 1ms - a 30-second job firing ~1000 times a second.
 */
function refreshIntervalSeconds(): number {
  return envInt('REFRESH_INTERVAL_SECONDS', 30, { min: 1 });
}

function presenceLeaseMs(): number {
  return refreshIntervalSeconds() * 3_000;
}

/**
 * Socket.io types `handshake.address` loosely; coerce it to a plain string,
 * falling back to '' when it is absent or non-string (matches checkOnHome's
 * expectation of a string IP).
 */
function extractRequestIp(address: unknown): string {
  return typeof address === 'string' ? address : '';
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:8081',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    IRealtimeService,
    OnModuleDestroy,
    OnApplicationShutdown
{
  @WebSocketServer() private readonly server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private pushSchedulerTimer: NodeJS.Timeout | undefined;
  private redisAdapterClients: Redis[] = [];
  private readonly activeAiUsers = new Set<string>();

  constructor(
    private readonly redis: RedisService,
    private readonly dataSourcesService: DataSourcesService,
    private readonly aiService: AiService,
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly permissionsService: PermissionsService,
    private readonly permissionsRepo: PermissionsRepository,
    @Inject(forwardRef(() => NetworksService))
    private readonly networksService: NetworksService,
  ) {}

  afterInit(server: Server): void {
    // Nest does not await this hook. Keep resource installation synchronous so shutdown can never
    // run first and then have a suspended initializer resurrect clients or a timer afterward.
    void this.cleanupLegacyPresence().catch((err) => {
      this.logger.warn({ err }, 'Legacy socket presence cleanup failed; a later restart will retry');
    });

    // The socket.io Redis adapter fans events across API replicas. Single-node mode
    // (Redis disabled) uses socket.io's default in-memory adapter - correct because
    // there is only one process and no cross-node fan-out is needed.
    if (this.redis.enabled) {
      const pubClient = this.redis.duplicate();
      const subClient = this.redis.duplicate();
      this.redisAdapterClients.push(pubClient, subClient);
      server.adapter(createAdapter(pubClient, subClient));
    }

    const intervalMs = refreshIntervalSeconds() * 1000;

    // Two DIFFERENT jobs, and the Redis lock in runPushScheduler only does one of them.
    // That lock is set with `EX <interval> NX` and never released, so it dedupes the push
    // ACROSS REPLICAS within a window - but its TTL equals the tick interval, which means it
    // expires exactly as the next tick fires. A push cycle that overruns the interval (many
    // orgs, a slow getLatestMetrics) therefore does NOT block the next tick: the lock is
    // already gone, the tick re-acquires it, and a second cycle runs on top of the first.
    // nonOverlapping is the missing IN-PROCESS guard; the lock stays for the cross-replica job.
    const pushTick = nonOverlapping(
      () => this.runPushScheduler(),
      () =>
        this.logger.warn(
          { intervalMs },
          'metrics push still running when the next tick fired - skipping it. Pushes are taking ' +
            'longer than REFRESH_INTERVAL_SECONDS; raise it or speed up getLatestMetrics.',
        ),
    );
    const presenceTick = nonOverlapping(
      () => this.refreshLocalSocketPresence(),
      () =>
        this.logger.warn(
          { intervalMs },
          'socket presence refresh still running when the next tick fired - skipping it',
        ),
    );
    this.pushSchedulerTimer = setInterval(() => {
      // Presence renewal is deliberately outside the potentially long push cycle's overlap
      // guard. A slow metrics query must never make healthy sockets look expired.
      void presenceTick();
      void pushTick();
    }, intervalMs);

    this.logger.log('RealtimeGateway initialized');
  }

  async handleConnection(client: Socket): Promise<void> {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(client.handshake.headers),
    });

    if (!session) {
      client.disconnect(true);
      return;
    }

    client.data.user = session.user;
    client.data.session = session.session;

    const userId = (session.user as { id: string }).id;
    const tier = (session.user as { tier: string }).tier;

    // Resolve the user's organization membership and store the orgId on the socket.
    // Fresh users with no OrganizationMember row will have orgId = null.
    // Metrics ingest guards against null orgId (see handleMetricsSubmit) to avoid
    // violating the NOT NULL constraint on DeviceMetric.organizationId.
    // The no-org gap is resolved in the F1a convergence task (B5).
    const orgMember = await this.organizationsRepository.findMemberByUserId(userId);
    client.data.orgId = orgMember?.organizationId ?? null;

    await client.join(`user:${userId}`);
    await client.join(`tier:${tier}`);
    if (client.data.orgId) {
      await client.join(`org:${client.data.orgId as string}`);
    }

    // Cache effective roots for scoped fan-out (F3 Phase D).
    // null  = OWNER/unscoped (receives all org events)
    // []    = no access / no org membership
    // [...] = scoped to these root property ids
    const permMember = client.data.orgId
      ? await this.permissionsRepo.findMember(client.data.orgId as string, userId)
      : null;
    client.data.memberId = permMember?.id ?? null;
    client.data.effectiveRoots = permMember
      ? (permMember.role === 'OWNER'
          ? null
          : await this.permissionsService.effectiveRoots(client.data.orgId as string, permMember.id))
      : [];

    // Join the rooms mirroring this socket's scope so scoped events reach it by room.
    await this.syncScopeRooms(client);

    await this.writeSocketPresence(client);

    const requestIp = extractRequestIp(client.handshake.address);
    const onHomeResult = await this.networksService.checkOnHome(userId, requestIp);
    client.data.onHome = onHomeResult.onHome;
    this.pushToUser(userId, WS_EVENTS.NETWORK_ON_HOME_CHANGED, onHomeResult);

    this.logger.log({ userId, orgId: client.data.orgId, socketId: client.id }, 'Client connected');
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = (client.data.user as { id: string } | undefined)?.id;
    if (userId) {
      await this.redis.hdel(REDIS_KEY_SOCKET_PRESENCE, client.id);
      this.logger.log({ userId, socketId: client.id }, 'Client disconnected');
    }
  }

  @SubscribeMessage(WS_EVENTS.PING)
  handlePing(): WsResponse<null> {
    return { event: WS_EVENTS.PONG, data: null };
  }

  @SubscribeMessage(WS_EVENTS.METRICS_SUBMIT)
  async handleMetricsSubmit(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: MetricsSubmitPayload,
  ): Promise<void> {
    const userId = (client.data.user as { id: string } | undefined)?.id;
    if (!userId) return;

    // Guard: fresh users with no org membership cannot write metrics (the
    // DeviceMetric.organizationId column is NOT NULL). This gap is resolved
    // in the F1a convergence task (B5) where new users are auto-enrolled in
    // a personal org at registration time.
    const orgId = client.data.orgId as string | null | undefined;
    if (!orgId) {
      this.logger.warn({ userId }, 'Metrics ingest skipped - socket has no orgId (user not yet in an org)');
      return;
    }

    // Guard the DB-write path: past the per-user window cap, silently drop the message. This
    // matches how the handler already rejects unwritable submissions (return without emitting),
    // and a debug-level log keeps the drop observable without letting a flood turn into a
    // warn-log amplification of its own.
    if (!(await this.withinMetricsRateLimit(userId))) {
      this.logger.debug({ userId, orgId }, 'metrics:submit dropped - per-user rate limit exceeded');
      return;
    }

    // The payload is not size/shape-validated here on purpose: WS payloads bypass the global
    // ValidationPipe, and DataSourcesService.parseRawPayload (called by ingest) already bounds
    // every field's number magnitude and string length. Re-validating here would duplicate it.
    const ingestPayload: Record<string, unknown> = { ...(payload ?? {}) };
    await this.dataSourcesService.ingest(orgId, userId, ingestPayload);
  }

  /**
   * Fixed-window per-user cap for metrics:submit. INCRs the minute-bucketed counter and reports
   * whether this submission is within WS_METRICS_MAX_PER_WINDOW. The EX ttl only cleans the
   * stale key up once its window has rolled (the key already self-rolls via its minute tag),
   * following the AI rate limiter's incr+expire pipeline pattern.
   *
   * Fail-open: a Redis blip returns "allowed" rather than dropping the metric, matching
   * RedisThrottlerStorage's house rule - a limiter degrading to "unlimited" during a Redis
   * outage is far better than silently losing every legitimate client's data.
   */
  private async withinMetricsRateLimit(userId: string): Promise<boolean> {
    const key = metricsRateKey(userId);
    try {
      const pipeline = this.redis.pipeline();
      pipeline.incr(key);
      pipeline.expire(key, WS_METRICS_WINDOW_SECONDS);
      const results = await pipeline.exec();

      // exec() resolves to ioredis-shaped [err, value] tuples; results[0] is the INCR. A null
      // result, a per-command error, or a non-numeric count all mean "count unknown" - fail open.
      const incr = results?.[0];
      if (!incr || incr[0]) return true;
      const count = Number(incr[1]);
      if (!Number.isFinite(count)) return true;
      return count <= WS_METRICS_MAX_PER_WINDOW;
    } catch (err) {
      this.logger.warn(
        { err, userId },
        'Metrics rate-limit check failed - allowing submission (fail-open)',
      );
      return true;
    }
  }

  pushToUser(userId: string, event: string, payload: unknown): void {
    this.emitToRoom(`user:${userId}`, event, payload);
  }

  pushToTier(tier: AccountTier, event: string, payload: unknown): void {
    this.emitToRoom(`tier:${tier}`, event, payload);
  }

  pushToOrg(orgId: string, event: string, payload: unknown): void {
    this.emitToRoom(`org:${orgId}`, event, payload);
  }

  private emitToRoom(room: string, event: string, payload: unknown): void {
    this.server.to(room).emit(event, payload);
  }

  async getConnectionStatus(userId: string): Promise<ConnectionStatus> {
    const presence = await this.readLiveSocketPresence();
    return presence.some((socket) => socket.userId === userId) ? 'connected' : 'offline';
  }

  async recomputeOnHomeForUser(userId: string): Promise<void> {
    const sockets = await this.server.in(`user:${userId}`).fetchSockets();
    for (const socket of sockets) {
      const requestIp = extractRequestIp(socket.handshake.address);
      const result = await this.networksService.checkOnHome(userId, requestIp);
      socket.data.onHome = result.onHome;
      socket.emit(WS_EVENTS.NETWORK_ON_HOME_CHANGED, result);
    }
  }

  /**
   * Join the socket to the rooms that mirror its F3 scope, so scoped events can be
   * addressed by room instead of fetching + filtering every org socket per event:
   *   effectiveRoots === null → `owner:<org>` (OWNER - sees every org event)
   *   effectiveRoots [...]     → `scope:<rootId>` for each root
   *   effectiveRoots []        → no scope rooms (no access)
   * Idempotent: leaves any previously-joined scope/owner rooms first, so it also applies
   * a scope change on resync. (Property ids are globally-unique UUIDs, so `scope:<id>`
   * rooms never collide across orgs; the owner room is org-scoped.)
   */
  private async syncScopeRooms(client: Socket): Promise<void> {
    for (const room of client.rooms) {
      if (room.startsWith('scope:') || room.startsWith('owner:')) await client.leave(room);
    }
    const orgId = client.data.orgId as string | null | undefined;
    if (!orgId) return;
    const roots = client.data.effectiveRoots as string[] | null;
    if (roots === null) {
      await client.join(`owner:${orgId}`);
    } else {
      for (const rootId of roots) await client.join(`scope:${rootId}`);
    }
  }

  /** Rooms covering everyone who can see any of the given governing-site ancestor ids. */
  private scopeRooms(orgId: string, ancestorIds: string[]): string[] {
    return [`owner:${orgId}`, ...new Set(ancestorIds.map((a) => `scope:${a}`))];
  }

  async emitScoped(orgId: string, governingSiteId: string, event: string, payload: unknown): Promise<void> {
    const ancestors = await this.permissionsRepo.ancestorPropertyIds(orgId, governingSiteId);
    this.server.to(this.scopeRooms(orgId, ancestors)).emit(event, payload);
  }

  async emitScopedMulti(orgId: string, governingSiteIds: string[], event: string, payload: unknown): Promise<void> {
    const lists = await Promise.all(governingSiteIds.map((id) => this.permissionsRepo.ancestorPropertyIds(orgId, id)));
    this.server.to(this.scopeRooms(orgId, lists.flat())).emit(event, payload);
  }

  notifyAccessChanged(orgId: string, userId: string): void {
    this.server.to(`user:${userId}`).emit(WS_EVENTS.ACCESS_CHANGED, { organizationId: orgId });
  }

  /**
   * Evict a user removed from an org by disconnecting their live sockets. Their
   * `socket.data.orgId` is set at connection and never refreshed mid-session, so a
   * removed member's open socket would otherwise keep receiving `org:`/`scope:`
   * broadcasts and keep ingesting metrics under that stale orgId. A room-leave can't
   * fix the latter cross-node (RemoteSocket.data is a read-only snapshot on remote
   * nodes); a disconnect propagates via the Redis adapter and forces handleConnection
   * to re-resolve membership (now none) on the client's automatic reconnect. Scoped to
   * `orgId` so unrelated sessions (future multi-org) are untouched.
   */
  async evictOrgMember(orgId: string, userId: string): Promise<void> {
    const sockets = await this.server.in(`user:${userId}`).fetchSockets();
    for (const socket of sockets) {
      if ((socket.data as { orgId?: string | null }).orgId === orgId) {
        socket.disconnect(true);
      }
    }
  }

  /**
   * Resync handler: client fires 'resync' after receiving ACCESS_CHANGED so the
   * gateway re-caches their effective roots without a full reconnect cycle.
   */
  @SubscribeMessage('resync')
  async onResync(@ConnectedSocket() client: Socket): Promise<void> {
    const orgId = client.data.orgId as string | null | undefined;
    const userId = (client.data.user as { id: string } | undefined)?.id;
    if (!orgId || !userId) return;
    const member = await this.permissionsRepo.findMember(orgId, userId);
    // A vanished membership only re-scopes (effectiveRoots → []) here; it deliberately
    // does NOT evict from the org room or null orgId. Removal-from-org is handled
    // authoritatively by removeMember → evictOrgMember (a force-disconnect). Treating a
    // null read as eviction here would turn a transient DB blip (e.g. a lagging replica)
    // into a durable drop of a still-valid member, with no self-healing trigger.
    client.data.effectiveRoots = member
      ? (member.role === 'OWNER'
          ? null
          : await this.permissionsService.effectiveRoots(orgId, member.id))
      : [];
    // Re-join scope rooms to match the refreshed roots.
    await this.syncScopeRooms(client);
  }

  private async runPushScheduler(): Promise<void> {
    // Fired from setInterval, so this must never reject: the lock-acquisition redis.set was
    // once outside the try, and a Redis blip there became an unhandled rejection and a
    // silently-dropped tick. Wrap the whole cycle so a transient Redis error is logged and the
    // tick is simply skipped (the next one retries).
    //
    // The lock below elects ONE replica per window. It is not an overlap guard - see the
    // nonOverlapping wrapper in afterInit for that, and why this lock cannot do that job.
    try {
      const ttl = refreshIntervalSeconds();
      const acquired = await this.redis.set(
        REDIS_KEY_PUSH_SCHEDULER_LOCK,
        '1',
        'EX',
        ttl,
        'NX',
      );
      if (!acquired) return;

      await this.pushLatestMetricsToConnectedUsers();
    } catch (err) {
      this.logger.error({ err }, 'Push scheduler cycle failed');
    }
  }

  /**
   * One query per org, but the orgs used to run STRICTLY SERIALLY: cycle wall-time was the number
   * of orgs with a connected user times the query latency, so a few hundred online orgs pushed the
   * cycle past its interval - which is what made the missing overlap guard fatal rather than
   * merely untidy. Run them with a bounded fan-out instead: fast enough that the cycle fits, and
   * capped so a busy push cannot drain the Prisma pool that every HTTP handler shares.
   */
  private async pushLatestMetricsToConnectedUsers(): Promise<void> {
    const orgToUsers = await this.connectedUsersByOrg();
    await mapLimit([...orgToUsers], PUSH_ORG_CONCURRENCY, async ([orgId, userIds]) => {
      const metricsMap = await this.dataSourcesService.getLatestMetrics(orgId, [...userIds]);
      for (const [userId, metrics] of metricsMap) {
        this.pushToUser(userId, WS_EVENTS.METRICS_UPDATE, {
          metrics,
          sourceTypes: ['browser'],
        } satisfies { metrics: MetricsDto; sourceTypes: string[] });
      }
    });
  }

  /**
   * Connected (org -> unique userIds) for the metrics push. Reads leased socket presence
   * in one Redis call, removes stale records, and deduplicates users. Falls back to a cluster-wide
   * fetchSockets() scan if the index read fails, so a Redis blip can't silently stop the
   * live-metrics feature.
   */
  private async connectedUsersByOrg(): Promise<Map<string, Set<string>>> {
    const orgToUsers = new Map<string, Set<string>>();
    try {
      const presence = await this.readLiveSocketPresence();
      for (const socket of presence) {
        if (!socket.organizationId) continue;
        const bucket = orgToUsers.get(socket.organizationId) ?? new Set<string>();
        bucket.add(socket.userId);
        orgToUsers.set(socket.organizationId, bucket);
      }
      return orgToUsers;
    } catch (err) {
      this.logger.warn({ err }, 'Socket presence unavailable - falling back to fetchSockets for metrics push');
      const sockets = await this.server.fetchSockets();
      for (const s of sockets) {
        const userId = (s.data.user as { id: string } | undefined)?.id;
        const orgId = s.data.orgId as string | null | undefined;
        if (!userId || !orgId) continue;
        const bucket = orgToUsers.get(orgId) ?? new Set<string>();
        bucket.add(userId);
        orgToUsers.set(orgId, bucket);
      }
      return orgToUsers;
    }
  }

  private async writeSocketPresence(client: Socket, now = Date.now()): Promise<void> {
    const userId = (client.data.user as { id: string } | undefined)?.id;
    if (!userId) return;
    const organizationId = client.data.orgId as string | null | undefined;
    await this.redis.hset(
      REDIS_KEY_SOCKET_PRESENCE,
      client.id,
      encodeSocketPresence({
        userId,
        organizationId: organizationId ?? null,
        expiresAt: now + presenceLeaseMs(),
      }),
    );
  }

  private async refreshLocalSocketPresence(): Promise<void> {
    const localSockets = this.server.sockets?.sockets;
    if (!localSockets) return;
    const now = Date.now();
    await Promise.all([...localSockets.values()].map((socket) => this.writeSocketPresence(socket, now)));
  }

  private async readLiveSocketPresence(now = Date.now()): Promise<LiveSocketPresence[]> {
    const fields = await this.redis.hgetall(REDIS_KEY_SOCKET_PRESENCE);
    const { live, staleEntries } = partitionSocketPresence(fields, now);
    for (let i = 0; i < staleEntries.length; i += PRESENCE_DELETE_BATCH_SIZE) {
      // Renewal can race this reader on another replica. Compare-and-delete the exact serialized
      // value we observed so a fresh lease written after HGETALL is never removed as stale.
      await this.redis.hdelIfValues(
        REDIS_KEY_SOCKET_PRESENCE,
        staleEntries.slice(i, i + PRESENCE_DELETE_BATCH_SIZE),
      );
    }
    return live;
  }

  private async cleanupLegacyPresence(): Promise<void> {
    await this.redis.del(REDIS_KEY_CONN_ORG);
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        'nodescope:connections:*',
        'COUNT',
        500,
      );
      if (keys.length > 0) await this.redis.del(...keys);
      cursor = nextCursor;
    } while (cursor !== '0');
  }

  @SubscribeMessage(WS_EVENTS.AI_MESSAGE)
  async handleAiMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { content?: string; conversationId?: string },
  ): Promise<void> {
    const user = client.data.user as { id: string; tier: string } | undefined;
    if (!user) return;

    const content = typeof payload?.content === 'string' ? payload.content.trim() : '';
    if (!content || content.length > 2000) return;
    // Usage accounting happens after completion, so concurrent stalled streams used to bypass
    // the quota and retain one fetch reader/prompt/handler apiece. The adapter has a deadline too;
    // this guard caps each user at one in-flight stream even before that deadline expires.
    if (this.activeAiUsers.has(user.id)) return;
    this.activeAiUsers.add(user.id);

    const ip = client.handshake.address ?? '0.0.0.0';

    const onToken = (token: string, conversationId: string) => {
      this.pushToUser(user.id, WS_EVENTS.AI_TOKEN, { token, conversationId });
    };

    const orgId = client.data.orgId as string | null | undefined;

    try {
      const result = await this.aiService.sendMessageStream(
        orgId ?? '',
        user.id,
        user.tier,
        ip,
        { content, conversationId: payload.conversationId },
        onToken,
      );

      this.pushToUser(user.id, WS_EVENTS.AI_COMPLETE, {
        content: result.content,
        conversationId: result.conversationId,
        tokensUsed: result.tokensUsed,
        monthlyBudgetRemaining: result.monthlyBudgetRemaining,
        usageWarning: result.usageWarning,
        providerStatus: result.providerStatus,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      if (err instanceof NodeScopeException) {
        this.pushToUser(user.id, WS_EVENTS.ERROR, {
          code: err.code,
          message: String((err.getResponse() as { message?: string }).message ?? err.message),
          context: 'ai',
        });
      } else {
        this.logger.error({ err }, 'Unexpected error in AI WS handler');
        this.pushToUser(user.id, WS_EVENTS.ERROR, {
          code: 'GEN_003',
          message: 'INTERNAL_ERROR',
          context: 'ai',
        });
      }
    } finally {
      this.activeAiUsers.delete(user.id);
    }
  }

  onModuleDestroy(): void {
    // Stop new work immediately: the scheduler must not fire another cycle while the
    // app is tearing down. The adapter's Redis clients are deliberately NOT closed
    // here - see onApplicationShutdown.
    if (this.pushSchedulerTimer !== undefined) {
      clearInterval(this.pushSchedulerTimer);
      this.pushSchedulerTimer = undefined;
    }
    this.activeAiUsers.clear();
  }

  /**
   * The socket.io Redis adapter's pub/sub clients outlive onModuleDestroy on purpose.
   * Nest's shutdown order is:
   *
   *   callDestroyHook()  → onModuleDestroy
   *   callBeforeShutdownHook()
   *   dispose()          → socketModule.close() → RedisAdapter.close() → punsubscribe()
   *   callShutdownHook() → onApplicationShutdown
   *
   * Quitting the clients in onModuleDestroy meant the adapter unsubscribed against an
   * already-closed connection during dispose(), and ioredis threw an uncaught
   * "Connection is closed." that took the process down on every graceful shutdown.
   * onApplicationShutdown is the first phase that runs after the adapter is done with them.
   */
  async onApplicationShutdown(): Promise<void> {
    const clients = this.redisAdapterClients.splice(0);
    await Promise.allSettled(clients.map((client) => client.quit()));
  }
}
