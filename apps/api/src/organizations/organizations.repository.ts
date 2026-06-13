import { Injectable } from '@nestjs/common';
import { Prisma, Organization, OrganizationDomain, OrganizationMember, OrgRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrganizationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createOrganization(data: { name: string }): Promise<Organization> {
    return this.prisma.organization.create({ data });
  }

  findOrganizationById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { id } });
  }

  async updateOrganizationWithVersion(
    id: string,
    data: Prisma.OrganizationUpdateInput,
    expectedVersion: number,
  ): Promise<Organization | null> {
    const result = await this.prisma.organization.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.prisma.organization.findUnique({ where: { id } });
  }

  addDomain(organizationId: string, domain: string): Promise<OrganizationDomain> {
    return this.prisma.organizationDomain.create({ data: { organizationId, domain } });
  }

  findOrganizationByDomain(
    domain: string,
  ): Promise<(OrganizationDomain & { organization: Organization }) | null> {
    return this.prisma.organizationDomain.findUnique({
      where: { domain },
      include: { organization: true },
    });
  }

  createMember(userId: string, organizationId: string, role: OrgRole): Promise<OrganizationMember> {
    return this.prisma.organizationMember.create({ data: { userId, organizationId, role } });
  }

  findMemberByUserId(userId: string): Promise<OrganizationMember | null> {
    return this.prisma.organizationMember.findUnique({ where: { userId } });
  }

  findMembersByOrganizationId(organizationId: string): Promise<OrganizationMember[]> {
    return this.prisma.organizationMember.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  findMemberByUserAndOrg(userId: string, organizationId: string): Promise<OrganizationMember | null> {
    return this.prisma.organizationMember.findFirst({ where: { userId, organizationId } });
  }

  updateMemberRole(userId: string, organizationId: string, role: OrgRole): Promise<Prisma.BatchPayload> {
    return this.prisma.organizationMember.updateMany({
      where: { userId, organizationId },
      data: { role },
    });
  }

  deleteMember(userId: string, organizationId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.organizationMember.deleteMany({ where: { userId, organizationId } });
  }

  countOwners(organizationId: string): Promise<number> {
    return this.prisma.organizationMember.count({ where: { organizationId, role: 'OWNER' } });
  }
}
