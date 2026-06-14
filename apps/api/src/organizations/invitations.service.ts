import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { OrgRole } from '@prisma/client';
import { WS_EVENTS } from '@nodescope/shared';
import { InvitationsRepository } from './invitations.repository';
import { OrganizationsRepository } from './organizations.repository';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly invitations: InvitationsRepository,
    private readonly orgs: OrganizationsRepository,
    private readonly realtime: ConflictResolutionService,
  ) {}

  async create(organizationId: string, email: string, role: OrgRole, invitedByUserId: string, actorRole: OrgRole) {
    if (actorRole === 'MEMBER') {
      throw new NodeScopeException('ORG_003', 'FORBIDDEN_ROLE', HttpStatus.FORBIDDEN);
    }
    if (actorRole !== 'OWNER' && role !== 'MEMBER') {
      throw new NodeScopeException('PERM_003', 'CANNOT_MANAGE_TARGET', HttpStatus.FORBIDDEN);
    }
    const normalized = email.trim().toLowerCase();
    await this.invitations.deletePendingByOrgAndEmail(organizationId, normalized);
    const token = randomBytes(32).toString('base64url');
    const invitation = await this.invitations.create({
      organizationId,
      email: normalized,
      role,
      token,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      invitedByUserId,
    });
    this.realtime.emitEntityEvent(
      WS_EVENTS.ORG_INVITATION_CREATED,
      { id: invitation.id, email: normalized },
      organizationId,
    );
    return { invitation, token };
  }

  listPending(organizationId: string) {
    return this.invitations.listPending(organizationId);
  }

  async revoke(organizationId: string, id: string) {
    const res = await this.invitations.deleteByIdAndOrg(id, organizationId);
    if (res.count === 0) {
      throw new NodeScopeException('ORG_009', 'INVITATION_INVALID', HttpStatus.NOT_FOUND);
    }
    this.realtime.emitEntityEvent(WS_EVENTS.ORG_INVITATION_REVOKED, { id }, organizationId);
  }

  async accept(userId: string, userEmail: string, token: string) {
    const invitation = await this.invitations.findByToken(token);
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.expiresAt.getTime() < Date.now()
    ) {
      throw new NodeScopeException('ORG_009', 'INVITATION_INVALID', HttpStatus.NOT_FOUND);
    }
    if (invitation.email !== userEmail.trim().toLowerCase()) {
      throw new NodeScopeException('ORG_010', 'INVITATION_EMAIL_MISMATCH', HttpStatus.FORBIDDEN);
    }
    if (await this.orgs.findMemberByUserId(userId)) {
      throw new NodeScopeException('ORG_011', 'ALREADY_A_MEMBER', HttpStatus.CONFLICT);
    }
    await this.orgs.createMember(userId, invitation.organizationId, invitation.role);
    await this.invitations.markAccepted(invitation.id);
    this.realtime.emitEntityEvent(
      WS_EVENTS.ORG_MEMBER_ADDED,
      { userId, role: invitation.role },
      invitation.organizationId,
    );
    this.realtime.emitEntityEvent(
      WS_EVENTS.ORG_INVITATION_ACCEPTED,
      { id: invitation.id, userId },
      invitation.organizationId,
    );
  }
}
