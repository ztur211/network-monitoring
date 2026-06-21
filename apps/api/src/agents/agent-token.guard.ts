import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AgentTokenService } from './agent-token.service';
import { AgentRepository } from './agent.repository';
import { RedisService } from '../redis/redis.service';

// lastSeenAt only needs ~seconds granularity; throttle the write so a chatty agent
// (heartbeat + every ingest) does at most one Postgres UPDATE per agent per window.
const LASTSEEN_THROTTLE_SECONDS = 60;

/**
 * Authenticates agent-facing requests via the `x-agent-token` header. On success
 * it attaches `{ orgId, agentId }` to the request as `req.agent` and bumps the
 * agent's last-seen timestamp. Revoked / unknown tokens are rejected.
 */
@Injectable()
export class AgentTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: AgentTokenService,
    private readonly repo: AgentRepository,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const resolved = await this.tokens.verifyToken(
      (req.headers['x-agent-token'] as string) ?? '',
    );
    if (!resolved) throw new UnauthorizedException('Invalid agent token');
    req.agent = resolved;
    await this.touchLastSeenThrottled(resolved.agentId);
    return true;
  }

  // Redis NX/EX gate: the first request in each window acquires the key and writes through
  // to Postgres; later requests within the window skip the write. On a Redis error we fall
  // back to writing so last-seen is never silently lost.
  private async touchLastSeenThrottled(agentId: string): Promise<void> {
    let write = true;
    try {
      const acquired = await this.redis.set(
        `agent:lastseen:${agentId}`,
        '1',
        'EX',
        LASTSEEN_THROTTLE_SECONDS,
        'NX',
      );
      write = acquired === 'OK';
    } catch {
      write = true;
    }
    if (write) await this.repo.touchLastSeen(agentId);
  }
}
