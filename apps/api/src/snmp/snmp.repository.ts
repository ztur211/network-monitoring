import { Injectable } from '@nestjs/common';
import { SnmpCredential, OidProfile, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SnmpRepository {
  constructor(private readonly prisma: PrismaService) {}

  createCredential(data: Prisma.SnmpCredentialUncheckedCreateInput): Promise<SnmpCredential> { return this.prisma.snmpCredential.create({ data }); }
  findCredential(organizationId: string, id: string): Promise<SnmpCredential | null> { return this.prisma.snmpCredential.findFirst({ where: { id, organizationId } }); }
  listCredentials(organizationId: string): Promise<SnmpCredential[]> { return this.prisma.snmpCredential.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }); }
  deleteCredential(id: string): Promise<unknown> { return this.prisma.snmpCredential.delete({ where: { id } }); }
  countCredentialAssignments(id: string): Promise<number> {
    return this.prisma.$transaction([this.prisma.network.count({ where: { snmpCredentialId: id } }), this.prisma.device.count({ where: { snmpCredentialId: id } })]).then(([n, d]) => n + d);
  }
  createProfile(data: { organizationId: string; name: string; includeInterfaceMetrics: boolean }, entries: { oid: string; metric: string }[]): Promise<OidProfile> {
    return this.prisma.oidProfile.create({ data: { ...data, entries: { create: entries } } });
  }
  findProfile(organizationId: string, id: string): Promise<(OidProfile & { entries: { oid: string; metric: string }[] }) | null> {
    return this.prisma.oidProfile.findFirst({ where: { id, organizationId }, include: { entries: true } }) as any;
  }
  listProfiles(organizationId: string): Promise<OidProfile[]> { return this.prisma.oidProfile.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }); }
  deleteProfile(id: string): Promise<unknown> { return this.prisma.oidProfile.delete({ where: { id } }); }
  countProfileAssignments(id: string): Promise<number> {
    return this.prisma.$transaction([this.prisma.network.count({ where: { oidProfileId: id } }), this.prisma.device.count({ where: { oidProfileId: id } })]).then(([n, d]) => n + d);
  }
  // resolution loads (Phase C)
  deviceWithSnmp(organizationId: string, deviceId: string) {
    return this.prisma.device.findFirst({ where: { id: deviceId, organizationId }, select: { id: true, snmpCredentialId: true, oidProfileId: true, network: { select: { snmpCredentialId: true, oidProfileId: true } } } });
  }
}
