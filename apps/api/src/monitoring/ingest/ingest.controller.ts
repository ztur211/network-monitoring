import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { IngestService } from './ingest.service';
import { IngestTokenService } from './ingest-token.service';
import { IngestTokenGuard } from './ingest-token.guard';
import { IngestBatchSizeGuard } from './ingest-batch-size.guard';
import { IngestBatchDto } from './ingest.dto';
import { Public } from '../../auth/decorators/public.decorator';
import { OrgId } from '../../organizations/decorators/org-id.decorator';
import { OrgRoles } from '../../organizations/decorators/org-roles.decorator';

@Controller('v1/monitoring')
export class IngestController {
  constructor(
    private readonly ingest: IngestService,
    private readonly tokens: IngestTokenService,
  ) {}

  /**
   * Agent-agnostic batch ingest. Authed by EITHER a per-agent token (x-agent-token) OR
   * the per-org ingest token (x-ingest-token / Bearer) — NOT a session,
   * so it is @Public (skips the session AuthGuard); the org is derived from the token.
   * A foreign-org deviceId fails per-item via IngestService (ORG_008).
   *
   * The body is bounded on three axes, all of which the agent knows about: bytes
   * (INGEST_BODY_LIMIT, applied by body-parser in main.ts), item count
   * (IngestBatchSizeGuard -> 413, split and retry) and per-field bounds
   * (IngestBatchDto via the global ValidationPipe -> 400, malformed). See ingest.dto.ts.
   */
  @Post('ingest')
  @Public()
  @UseGuards(IngestTokenGuard, IngestBatchSizeGuard)
  @HttpCode(202)
  async ingestBatch(@Req() req: { ingestOrgId: string; ingestSource?: string }, @Body() body: IngestBatchDto) {
    const organizationId = req.ingestOrgId;
    await this.ingest.ingestBatch(organizationId, body.checks ?? [], body.metrics ?? [], req.ingestSource);
    const accepted = (body.checks?.length ?? 0) + (body.metrics?.length ?? 0);
    return { success: true, data: { accepted }, timestamp: new Date().toISOString() };
  }

  /** OWNER-only: (re)generate the org ingest token. The secret is returned ONCE. */
  @Post('ingest-token')
  @OrgRoles('OWNER')
  async rotateToken(@OrgId() organizationId: string) {
    const token = await this.tokens.createOrRotate(organizationId);
    return { success: true, data: { token }, timestamp: new Date().toISOString() };
  }
}
