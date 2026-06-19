import { HttpStatus, Injectable } from '@nestjs/common';
import type { AgentDto } from '@nodescope/shared';
import { Agent } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { AgentRepository } from './agent.repository';
import { AgentTokenService } from './agent-token.service';

/**
 * Phase D Task 2: OWNER/ADMIN management operations for the agent registry.
 *
 * - Generate an enrollment code (handed to the collector operator)
 * - List agents in the org
 * - Revoke an agent (sets status REVOKED; invalidates its token)
 * - Delete an agent row (permanent removal)
 *
 * All mutating operations assert org-scope ownership before acting to prevent
 * an OWNER of org A from touching org B's agents.
 */
@Injectable()
export class AgentsService {
  constructor(
    private readonly repo: AgentRepository,
    private readonly tokens: AgentTokenService,
    private readonly audit: AuditService,
  ) {}

  async generateEnrollmentCode(
    organizationId: string,
    memberId: string,
  ): Promise<string> {
    return this.tokens.generateEnrollmentCode(organizationId, memberId);
  }

  async listAgents(organizationId: string): Promise<AgentDto[]> {
    const agents = await this.repo.listByOrg(organizationId);
    return agents.map(this.toDto);
  }

  async revokeAgent(
    organizationId: string,
    agentId: string,
    actorMemberId: string,
  ): Promise<{ id: string }> {
    const agent = await this.assertOrgScope(organizationId, agentId);
    await this.repo.setStatus(agentId, 'REVOKED');
    // Fire-and-forget audit is acceptable here; it must not block the response.
    await this.audit.recordUpdate(organizationId, 'Agent', agentId, [
      { field: 'status', oldValue: agent.status, newValue: 'REVOKED' },
    ]);
    void actorMemberId; // reserved for future audit ALS enrichment
    return { id: agentId };
  }

  async deleteAgent(
    organizationId: string,
    agentId: string,
    actorMemberId: string,
  ): Promise<{ id: string }> {
    const agent = await this.assertOrgScope(organizationId, agentId);
    await this.repo.delete(agentId);
    const { id, name, platform, version, status } = agent;
    await this.audit.recordDelete(organizationId, 'Agent', { id, name, platform, version, status });
    void actorMemberId;
    return { id: agentId };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async assertOrgScope(organizationId: string, agentId: string): Promise<Agent> {
    const agent = await this.repo.findById(agentId);
    if (!agent || agent.organizationId !== organizationId) {
      throw new NodeScopeException('AGENT_002', 'NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return agent;
  }

  private toDto(a: Agent): AgentDto {
    return {
      id: a.id,
      name: a.name,
      platform: a.platform,
      version: a.version,
      status: a.status as 'PENDING' | 'APPROVED' | 'REVOKED',
      lastSeenAt: a.lastSeenAt ? a.lastSeenAt.toISOString() : null,
    };
  }
}
