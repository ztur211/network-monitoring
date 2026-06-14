import { forwardRef, Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
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
import { fromNodeHeaders } from 'better-auth/node';
import { Server, Socket } from 'socket.io';
import { auth } from '../auth/better-auth.config';
import { RedisService } from '../redis/redis.service';
import { DataSourcesService } from '../data-sources/data-sources.service';
import { NetworksService } from '../networks/networks.service';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { AiService } from '../ai/ai.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { AccountTier, ConnectionStatus, MetricsDto, WS_EVENTS } from '@nodescope/shared';
import {
  IRealtimeService,
  REDIS_KEY_CONNECTIONS,
  REDIS_KEY_PUSH_SCHEDULER_LOCK,
} from './realtime.types';

interface MetricsSubmitPayload {
  bandwidthDown?: number;
  bandwidthUp?: number;
  latency?: number;
  connectionQuality?: string;
  tag?: string;
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
    OnModuleDestroy
{
  @WebSocketServer() private readonly server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private pushSchedulerTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly redis: RedisService,
    private readonly dataSourcesService: DataSourcesService,
    private readonly aiService: AiService,
    private readonly organizationsRepository: OrganizationsRepository,
    @Inject(forwardRef(() => NetworksService))
    private readonly networksService: NetworksService,
  ) {}

  async afterInit(server: Server): Promise<void> {
    const pubClient = this.redis.duplicate();
    const subClient = this.redis.duplicate();
    server.adapter(createAdapter(pubClient, subClient));

    const intervalMs =
      parseInt(process.env.REFRESH_INTERVAL_SECONDS ?? '30', 10) * 1000;
    this.pushSchedulerTimer = setInterval(() => {
      void this.runPushScheduler();
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
    const member = await this.organizationsRepository.findMemberByUserId(userId);
    client.data.orgId = member?.organizationId ?? null;

    await client.join(`user:${userId}`);
    await client.join(`tier:${tier}`);
    if (client.data.orgId) {
      await client.join(`org:${client.data.orgId as string}`);
    }

    await this.redis.sadd(REDIS_KEY_CONNECTIONS(userId), client.id);

    const requestIp = extractRequestIp(client.handshake.address);
    const onHomeResult = await this.networksService.checkOnHome(userId, requestIp);
    client.data.onHome = onHomeResult.onHome;
    this.pushToUser(userId, WS_EVENTS.NETWORK_ON_HOME_CHANGED, onHomeResult);

    this.logger.log({ userId, orgId: client.data.orgId, socketId: client.id }, 'Client connected');
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = (client.data.user as { id: string } | undefined)?.id;
    if (userId) {
      await this.redis.srem(REDIS_KEY_CONNECTIONS(userId), client.id);
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
      this.logger.warn({ userId }, 'Metrics ingest skipped — socket has no orgId (user not yet in an org)');
      return;
    }

    const ingestPayload: Record<string, unknown> = { ...(payload ?? {}) };
    await this.dataSourcesService.ingest(orgId, userId, ingestPayload);
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
    const count = await this.redis.scard(REDIS_KEY_CONNECTIONS(userId));
    return count > 0 ? 'connected' : 'offline';
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

  private async runPushScheduler(): Promise<void> {
    // Fired as `void this.runPushScheduler()` from setInterval with no global
    // unhandledRejection handler, so this must never reject. The lock-acquisition
    // redis.set was previously outside the try: a Redis blip there became an
    // unhandled rejection and a silently-dropped tick. Wrap the whole cycle so a
    // transient Redis error is logged and the tick is simply skipped (next one
    // retries).
    try {
      const ttl = parseInt(process.env.REFRESH_INTERVAL_SECONDS ?? '30', 10);
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

  private async pushLatestMetricsToConnectedUsers(): Promise<void> {
    // Collect all currently connected sockets that have a resolved orgId.
    // Sockets with no orgId (fresh users not yet in an org) are skipped —
    // their metrics were never ingested, so there is nothing to push.
    const sockets = await this.server.fetchSockets();

    // Group userIds by orgId so we can issue one DB query per org.
    const orgToUsers = new Map<string, string[]>();
    for (const s of sockets) {
      const userId = (s.data.user as { id: string } | undefined)?.id;
      const orgId = s.data.orgId as string | null | undefined;
      if (!userId || !orgId) continue;
      const bucket = orgToUsers.get(orgId) ?? [];
      bucket.push(userId);
      orgToUsers.set(orgId, bucket);
    }

    for (const [orgId, userIds] of orgToUsers) {
      const metricsMap = await this.dataSourcesService.getLatestMetrics(
        orgId,
        [...new Set(userIds)],
      );

      for (const [userId, metrics] of metricsMap) {
        this.pushToUser(userId, WS_EVENTS.METRICS_UPDATE, {
          metrics,
          sourceTypes: ['browser'],
        } satisfies { metrics: MetricsDto; sourceTypes: string[] });
      }
    }
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
    }
  }

  onModuleDestroy(): void {
    if (this.pushSchedulerTimer !== undefined) {
      clearInterval(this.pushSchedulerTimer);
    }
  }
}
