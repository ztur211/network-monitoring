import { Injectable } from '@nestjs/common';
import { SnmpCredential, OidProfile, OidEntry, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** The assignment chain a device's effective SNMP target is resolved from: its own overrides + its network's defaults. */
const DEVICE_SNMP_SELECT = {
  id: true,
  snmpCredentialId: true,
  oidProfileId: true,
  network: { select: { snmpCredentialId: true, oidProfileId: true } },
} satisfies Prisma.DeviceSelect;

export type DeviceSnmpRow = Prisma.DeviceGetPayload<{ select: typeof DEVICE_SNMP_SELECT }>;

/**
 * Postgres caps a statement at 65,535 bind parameters, so an unbounded `id: { in: [...] }`
 * is a latent hard failure on a big org. Chunk the id list instead: the query count is
 * O(ids / ID_CHUNK) - 5 round trips for 5,000 devices - and, crucially, it never grows one
 * query per device the way a findFirst-per-row loop does.
 */
const ID_CHUNK = 1_000;

@Injectable()
export class SnmpRepository {
  constructor(private readonly prisma: PrismaService) {}

  createCredential(data: Prisma.SnmpCredentialUncheckedCreateInput): Promise<SnmpCredential> { return this.prisma.snmpCredential.create({ data }); }
  findCredential(organizationId: string, id: string): Promise<SnmpCredential | null> { return this.prisma.snmpCredential.findFirst({ where: { id, organizationId } }); }
  listCredentials(organizationId: string): Promise<SnmpCredential[]> { return this.prisma.snmpCredential.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }); }
  deleteCredential(id: string): Promise<SnmpCredential> { return this.prisma.snmpCredential.delete({ where: { id } }); }
  countCredentialAssignments(id: string): Promise<number> {
    return this.prisma.$transaction([this.prisma.network.count({ where: { snmpCredentialId: id } }), this.prisma.device.count({ where: { snmpCredentialId: id } })]).then(([n, d]) => n + d);
  }
  createProfile(data: { organizationId: string; name: string; includeInterfaceMetrics: boolean }, entries: { oid: string; metric: string }[]): Promise<OidProfile & { entries: OidEntry[] }> {
    return this.prisma.oidProfile.create({ data: { ...data, entries: { create: entries } }, include: { entries: true } });
  }
  findProfile(organizationId: string, id: string): Promise<(OidProfile & { entries: OidEntry[] }) | null> {
    return this.prisma.oidProfile.findFirst({ where: { id, organizationId }, include: { entries: true } });
  }
  listProfiles(organizationId: string): Promise<OidProfile[]> { return this.prisma.oidProfile.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }); }
  deleteProfile(id: string): Promise<OidProfile> { return this.prisma.oidProfile.delete({ where: { id } }); }
  countProfileAssignments(id: string): Promise<number> {
    return this.prisma.$transaction([this.prisma.network.count({ where: { oidProfileId: id } }), this.prisma.device.count({ where: { oidProfileId: id } })]).then(([n, d]) => n + d);
  }

  // ─── resolution loads (Phase C) ───────────────────────────────────────────

  deviceWithSnmp(organizationId: string, deviceId: string): Promise<DeviceSnmpRow | null> {
    return this.prisma.device.findFirst({ where: { id: deviceId, organizationId }, select: DEVICE_SNMP_SELECT });
  }

  /**
   * Batch form of deviceWithSnmp - the ONLY load the agent device-sync path may use.
   *
   * Resolving a whole org's device list one findFirst at a time fires one query per device,
   * concurrently, from a single request. Those queries share the API-wide Prisma pool, so a
   * 5,000-device sync saturates it and every other in-flight request starts timing out (P2024).
   * This collapses it to a bounded number of round trips regardless of fleet size.
   *
   * Rows are returned unordered and unknown/foreign-org ids are simply absent - callers must
   * index by `id` rather than assume positional alignment with the input.
   */
  devicesWithSnmp(organizationId: string, deviceIds: string[]): Promise<DeviceSnmpRow[]> {
    return this.byIdChunks(deviceIds, (ids) =>
      this.prisma.device.findMany({ where: { organizationId, id: { in: ids } }, select: DEVICE_SNMP_SELECT }),
    );
  }

  findCredentialsByIds(organizationId: string, ids: string[]): Promise<SnmpCredential[]> {
    return this.byIdChunks(ids, (chunk) => this.prisma.snmpCredential.findMany({ where: { organizationId, id: { in: chunk } } }));
  }

  findProfilesByIds(organizationId: string, ids: string[]): Promise<(OidProfile & { entries: OidEntry[] })[]> {
    return this.byIdChunks(ids, (chunk) => this.prisma.oidProfile.findMany({ where: { organizationId, id: { in: chunk } }, include: { entries: true } }));
  }

  /** Run `load` over the de-duplicated ids in fixed-size chunks, in sequence, and concatenate the rows. */
  private async byIdChunks<R>(ids: string[], load: (chunk: string[]) => Promise<R[]>): Promise<R[]> {
    const unique = [...new Set(ids)];
    const rows: R[] = [];
    for (let i = 0; i < unique.length; i += ID_CHUNK) {
      rows.push(...(await load(unique.slice(i, i + ID_CHUNK))));
    }
    return rows;
  }
}
