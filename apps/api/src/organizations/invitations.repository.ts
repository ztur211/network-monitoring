import { Injectable } from '@nestjs/common';
import { Invitation, OrgRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InvitationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    organizationId: string;
    email: string;
    role: OrgRole;
    token: string;
    expiresAt: Date;
    invitedByUserId: string | null;
  }): Promise<Invitation> {
    return this.prisma.invitation.create({ data });
  }

  findByToken(token: string): Promise<Invitation | null> {
    return this.prisma.invitation.findUnique({ where: { token } });
  }

  findPendingByOrgAndEmail(organizationId: string, email: string): Promise<Invitation | null> {
    return this.prisma.invitation.findFirst({
      where: { organizationId, email, acceptedAt: null },
    });
  }

  listPending(organizationId: string): Promise<Invitation[]> {
    return this.prisma.invitation.findMany({
      where: { organizationId, acceptedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  deletePendingByOrgAndEmail(organizationId: string, email: string): Promise<Prisma.BatchPayload> {
    return this.prisma.invitation.deleteMany({
      where: { organizationId, email, acceptedAt: null },
    });
  }

  deleteByIdAndOrg(id: string, organizationId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.invitation.deleteMany({
      where: { id, organizationId, acceptedAt: null },
    });
  }

  markAccepted(id: string): Promise<Invitation> {
    return this.prisma.invitation.update({
      where: { id },
      data: { acceptedAt: new Date() },
    });
  }
}
