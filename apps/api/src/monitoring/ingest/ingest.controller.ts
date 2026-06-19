import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { IngestBatchDto } from '@nodescope/shared';
import { IngestService } from './ingest.service';
import { IngestTokenService } from './ingest-token.service';
import { IngestTokenGuard } from './ingest-token.guard';
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
   * Agent-agnostic batch ingest. Authed by the per-org ingest token (NOT a session),
   * so it is @Public (skips the session AuthGuard); the org is derived from the token.
   * A foreign-org deviceId fails per-item via IngestService (ORG_008).
   */
  @Post('ingest')
  @Public()
  @UseGuards(IngestTokenGuard)
  @HttpCode(202)
  async ingestBatch(@Req() req: { ingestOrgId: string }, @Body() body: IngestBatchDto) {
    const organizationId = req.ingestOrgId;
    for (const c of body.checks ?? []) {
      await this.ingest.reportStatusCheck({
        organizationId,
        deviceId: c.deviceId,
        ok: c.ok,
        latencyMs: c.latencyMs,
        source: c.source ?? 'agent',
      });
    }
    for (const m of body.metrics ?? []) {
      await this.ingest.reportMetric({
        organizationId,
        deviceId: m.deviceId,
        metric: m.metric,
        value: m.value,
        source: m.source ?? 'agent',
        ts: m.ts ? new Date(m.ts) : undefined,
      });
    }
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
