import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AgentTokenService } from './agent-token.service';
import { AgentRepository } from './agent.repository';

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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const resolved = await this.tokens.verifyToken(
      (req.headers['x-agent-token'] as string) ?? '',
    );
    if (!resolved) throw new UnauthorizedException('Invalid agent token');
    req.agent = resolved;
    await this.repo.touchLastSeen(resolved.agentId);
    return true;
  }
}
