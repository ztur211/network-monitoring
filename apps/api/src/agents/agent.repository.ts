import { Injectable } from '@nestjs/common';
import { Agent, AgentStatus, AgentEnrollmentCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Persistence for the Spec 8 agent registry: the `Agent` rows (one per enrolled
 * collector) and the short-lived `AgentEnrollmentCode` rows used to bootstrap a
 * token. All access is Prisma-managed.
 */
@Injectable()
export class AgentRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(d: {
    organizationId: string;
    name: string;
    platform: string | null;
    version: string | null;
    tokenHash: string;
    createdByMemberId: string | null;
  }): Promise<Agent> {
    return this.prisma.agent.create({ data: { ...d, status: 'APPROVED' } });
  }

  findById(id: string): Promise<Agent | null> {
    return this.prisma.agent.findUnique({ where: { id } });
  }

  findByTokenHash(tokenHash: string): Promise<Agent | null> {
    return this.prisma.agent.findUnique({ where: { tokenHash } });
  }

  listByOrg(organizationId: string): Promise<Agent[]> {
    return this.prisma.agent.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  touchLastSeen(id: string): Promise<unknown> {
    return this.prisma.agent.update({
      where: { id },
      data: { lastSeenAt: new Date() },
    });
  }

  setStatus(id: string, status: AgentStatus): Promise<unknown> {
    return this.prisma.agent.update({ where: { id }, data: { status } });
  }

  delete(id: string): Promise<unknown> {
    return this.prisma.agent.delete({ where: { id } });
  }

  createCode(d: {
    organizationId: string;
    codeHash: string;
    expiresAt: Date;
    createdByMemberId: string | null;
  }): Promise<AgentEnrollmentCode> {
    return this.prisma.agentEnrollmentCode.create({ data: d });
  }

  findValidCode(codeHash: string): Promise<AgentEnrollmentCode | null> {
    return this.prisma.agentEnrollmentCode.findFirst({
      where: { codeHash, usedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  markCodeUsed(id: string): Promise<unknown> {
    return this.prisma.agentEnrollmentCode.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }
}
