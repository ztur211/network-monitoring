import { Injectable } from '@nestjs/common';
import { JoinRequest, JoinRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JoinRequestsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(organizationId: string, userId: string): Promise<JoinRequest> {
    return this.prisma.joinRequest.create({ data: { organizationId, userId } });
  }

  findPendingByUser(userId: string): Promise<JoinRequest | null> {
    return this.prisma.joinRequest.findFirst({ where: { userId, status: 'PENDING' } });
  }

  findByIdAndOrg(id: string, organizationId: string): Promise<JoinRequest | null> {
    return this.prisma.joinRequest.findFirst({ where: { id, organizationId } });
  }

  listByOrgAndStatus(organizationId: string, status: JoinRequestStatus): Promise<JoinRequest[]> {
    return this.prisma.joinRequest.findMany({
      where: { organizationId, status },
      orderBy: { createdAt: 'desc' },
    });
  }

  decide(id: string, status: JoinRequestStatus, decidedByUserId: string): Promise<JoinRequest> {
    return this.prisma.joinRequest.update({
      where: { id },
      data: { status, decidedByUserId, decidedAt: new Date() },
    });
  }
}
