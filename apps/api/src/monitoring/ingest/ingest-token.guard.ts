import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { IngestTokenService } from './ingest-token.service';
import { AgentTokenService } from '../../agents/agent-token.service';
import { AgentRepository } from '../../agents/agent.repository';

/**
 * Authenticates the ingest endpoint by trying the per-agent token (`x-agent-token`)
 * first, then falling back to the per-org ingest token (`x-ingest-token` / Bearer).
 * Accepts EITHER authentication method. On an agent token, attaches
 * req.ingestOrgId + req.ingestSource = `agent:<agentId>` and bumps lastSeenAt.
 * On an org token, attaches only req.ingestOrgId.
 */
@Injectable()
export class IngestTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: IngestTokenService,
    private readonly agentTokens: AgentTokenService,
    private readonly agentRepo: AgentRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    // 1. Try per-agent token (x-agent-token header) — only when the header is present
    //    to avoid an unnecessary DB hash-lookup on every org-token ingest.
    const agentToken = req.headers['x-agent-token'] as string | undefined;
    if (agentToken) {
      const agent = await this.agentTokens.verifyToken(agentToken);
      if (agent) {
        req.ingestOrgId = agent.orgId;
        req.ingestSource = `agent:${agent.agentId}`;
        await this.agentRepo.touchLastSeen(agent.agentId);
        return true;
      }
    }

    // 2. Fall back to per-org ingest token (x-ingest-token / Bearer).
    const header = req.headers['x-ingest-token'] as string | undefined;
    const bearer = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '');
    const token = header ?? bearer ?? '';
    const orgId = await this.tokens.verify(token);
    if (!orgId) throw new UnauthorizedException('Invalid ingest token');
    req.ingestOrgId = orgId;
    return true;
  }
}
