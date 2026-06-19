import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { IngestTokenService } from './ingest-token.service';

/**
 * Authenticates the ingest endpoint by the per-org ingest token (NOT a user session):
 * resolves the org from the token and attaches it as req.ingestOrgId. Accepts the token
 * via the `x-ingest-token` header or a Bearer authorization header.
 */
@Injectable()
export class IngestTokenGuard implements CanActivate {
  constructor(private readonly tokens: IngestTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header = req.headers['x-ingest-token'] as string | undefined;
    const bearer = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '');
    const token = header ?? bearer ?? '';
    const orgId = await this.tokens.verify(token);
    if (!orgId) throw new UnauthorizedException('Invalid ingest token');
    req.ingestOrgId = orgId;
    return true;
  }
}
