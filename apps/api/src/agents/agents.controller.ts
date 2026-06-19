import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { OrgId } from '../organizations/decorators/org-id.decorator';
import { OrgMember } from '../organizations/decorators/org-member.decorator';
import { OrgRoles } from '../organizations/decorators/org-roles.decorator';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { AgentsService } from './agents.service';

/**
 * Phase D Task 2: OWNER/ADMIN endpoints for agent management.
 *
 * All endpoints are session-authenticated (global AuthGuard) and restricted to
 * OWNER and ADMIN roles (OrgRoleGuard reads the @OrgRoles metadata). Responses
 * are manually wrapped in the standard { success, data, timestamp } envelope
 * because there is no global response interceptor.
 */
@Controller('v1/agents')
export class AgentsController {
  constructor(private readonly service: AgentsService) {}

  /**
   * Generate a short-lived, single-use enrollment code.
   * The code is returned once — only its hash is persisted.
   */
  @Post('enrollment-code')
  @OrgRoles('OWNER', 'ADMIN')
  async generateEnrollmentCode(
    @OrgId() orgId: string,
    @OrgMember() m: OrgMemberContext,
  ) {
    const code = await this.service.generateEnrollmentCode(orgId, m.id);
    return { success: true, data: { code }, timestamp: new Date().toISOString() };
  }

  /**
   * List all agents registered to the caller's organisation.
   */
  @Get()
  @OrgRoles('OWNER', 'ADMIN')
  async listAgents(@OrgId() orgId: string) {
    const data = await this.service.listAgents(orgId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  /**
   * Revoke an agent — sets its status to REVOKED so its token is rejected.
   * The agent row is preserved for audit purposes; use DELETE to remove it.
   */
  @Post(':id/revoke')
  @OrgRoles('OWNER', 'ADMIN')
  @HttpCode(200)
  async revokeAgent(
    @OrgId() orgId: string,
    @OrgMember() m: OrgMemberContext,
    @Param('id') id: string,
  ) {
    const data = await this.service.revokeAgent(orgId, id, m.id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  /**
   * Permanently delete an agent from the registry.
   */
  @Delete(':id')
  @OrgRoles('OWNER', 'ADMIN')
  async deleteAgent(
    @OrgId() orgId: string,
    @OrgMember() m: OrgMemberContext,
    @Param('id') id: string,
  ) {
    const data = await this.service.deleteAgent(orgId, id, m.id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
