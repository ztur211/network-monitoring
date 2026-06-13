import { HttpStatus, Injectable } from '@nestjs/common';
import { JoinRequestStatus } from '@prisma/client';
import { WS_EVENTS } from '@nodescope/shared';
import { JoinRequestsRepository } from './join-requests.repository';
import { OrganizationsRepository } from './organizations.repository';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';

@Injectable()
export class JoinRequestsService {
  constructor(
    private readonly requests: JoinRequestsRepository,
    private readonly orgs: OrganizationsRepository,
    private readonly realtime: ConflictResolutionService,
  ) {}

  async submit(userId: string, userEmail: string) {
    if (await this.orgs.findMemberByUserId(userId)) {
      throw new NodeScopeException('ORG_011', 'ALREADY_A_MEMBER', HttpStatus.CONFLICT);
    }
    const domain = userEmail.split('@')[1]?.toLowerCase() ?? '';
    const match = await this.orgs.findOrganizationByDomain(domain);
    if (!match) {
      throw new NodeScopeException('ORG_014', 'NO_MATCHING_ORG_FOR_DOMAIN', HttpStatus.NOT_FOUND);
    }
    if (await this.requests.findPendingByUser(userId)) {
      throw new NodeScopeException('ORG_015', 'DUPLICATE_JOIN_REQUEST', HttpStatus.CONFLICT);
    }
    const req = await this.requests.create(match.organization.id, userId);
    this.realtime.emitEntityEvent(WS_EVENTS.ORG_JOIN_REQUEST_CREATED, { id: req.id, userId }, match.organization.id);
    return req;
  }

  list(organizationId: string, status: JoinRequestStatus) {
    return this.requests.listByOrgAndStatus(organizationId, status);
  }

  async decide(organizationId: string, id: string, approve: boolean, deciderUserId: string) {
    const req = await this.requests.findByIdAndOrg(id, organizationId);
    if (!req || req.status !== 'PENDING') {
      throw new NodeScopeException('ORG_012', 'JOIN_REQUEST_INVALID', HttpStatus.NOT_FOUND);
    }
    if (approve) {
      if (await this.orgs.findMemberByUserId(req.userId)) {
        throw new NodeScopeException('ORG_011', 'ALREADY_A_MEMBER', HttpStatus.CONFLICT);
      }
      await this.orgs.createMember(req.userId, organizationId, 'MEMBER');
      this.realtime.emitEntityEvent(WS_EVENTS.ORG_MEMBER_ADDED, { userId: req.userId, role: 'MEMBER' }, organizationId);
    }
    await this.requests.decide(id, approve ? 'APPROVED' : 'DENIED', deciderUserId);
    this.realtime.emitEntityEvent(WS_EVENTS.ORG_JOIN_REQUEST_DECIDED, { id, approved: approve }, organizationId);
  }
}
