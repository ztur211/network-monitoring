import { HttpStatus, Injectable } from '@nestjs/common';
import type { SnmpCredential, OidProfile, OidEntry } from '@prisma/client';
import type {
  SnmpCredentialDto,
  CreateSnmpCredentialDto,
  OidProfileDto,
  OidProfileSummaryDto,
  CreateOidProfileDto,
  SnmpTargetDto,
  AgentDeviceDto,
} from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { CryptoService } from '../common/crypto/crypto.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { NetworksRepository } from '../networks/networks.repository';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { SnmpRepository } from './snmp.repository';
import type { DeviceSnmpRow } from './snmp.repository';
import type { AssignSnmpDto } from './snmp.dto';

/** The effective credential (+ optional OID profile) a device resolves to, before any decrypt. */
interface CredProfRef {
  credId: string;
  profId: string | null;
}

@Injectable()
export class SnmpService {
  constructor(
    private readonly repo: SnmpRepository,
    private readonly crypto: CryptoService,
    private readonly permissions: PermissionsService,
    private readonly prisma: PrismaService,
    private readonly networksRepository: NetworksRepository,
  ) {}

  // ─── Credentials ──────────────────────────────────────────────────────────

  async createCredential(
    organizationId: string,
    dto: CreateSnmpCredentialDto,
  ): Promise<SnmpCredentialDto> {
    const row = await this.repo.createCredential({
      organizationId,
      name: dto.name,
      snmpVersion: dto.snmpVersion,
      securityLevel: dto.securityLevel ?? null,
      securityName: dto.securityName ?? null,
      authProtocol: dto.authProtocol ?? null,
      privProtocol: dto.privProtocol ?? null,
      communityEnc: dto.community ? this.crypto.encrypt(dto.community) : null,
      authKeyEnc: dto.authKey ? this.crypto.encrypt(dto.authKey) : null,
      privKeyEnc: dto.privKey ? this.crypto.encrypt(dto.privKey) : null,
    });
    return this.toCredDto(row);
  }

  async getCredential(organizationId: string, id: string): Promise<SnmpCredentialDto> {
    const row = await this.repo.findCredential(organizationId, id);
    if (!row) throw new NodeScopeException('SNMP_001', 'SNMP credential not found', 404);
    return this.toCredDto(row);
  }

  async listCredentials(organizationId: string): Promise<SnmpCredentialDto[]> {
    const rows = await this.repo.listCredentials(organizationId);
    return rows.map((r) => this.toCredDto(r));
  }

  async deleteCredential(organizationId: string, id: string): Promise<void> {
    const row = await this.repo.findCredential(organizationId, id);
    if (!row) throw new NodeScopeException('SNMP_001', 'SNMP credential not found', 404);
    const count = await this.repo.countCredentialAssignments(id);
    if (count > 0)
      throw new NodeScopeException(
        'SNMP_003',
        'Cannot delete a credential that is still assigned to networks or devices',
        409,
      );
    await this.repo.deleteCredential(id);
  }

  // ─── Profiles ─────────────────────────────────────────────────────────────

  async createProfile(
    organizationId: string,
    dto: CreateOidProfileDto,
  ): Promise<OidProfileDto> {
    const row = await this.repo.createProfile(
      {
        organizationId,
        name: dto.name,
        includeInterfaceMetrics: dto.includeInterfaceMetrics ?? false,
      },
      dto.entries ?? [],
    );
    return this.toProfileDto(row);
  }

  async getProfile(organizationId: string, id: string): Promise<OidProfileDto> {
    const row = await this.repo.findProfile(organizationId, id);
    if (!row) throw new NodeScopeException('SNMP_002', 'OID profile not found', 404);
    return this.toProfileDto(row);
  }

  async listProfiles(organizationId: string): Promise<OidProfileSummaryDto[]> {
    const rows = await this.repo.listProfiles(organizationId);
    return rows.map((r) => this.toProfileSummaryDto(r));
  }

  async deleteProfile(organizationId: string, id: string): Promise<void> {
    const row = await this.repo.findProfile(organizationId, id);
    if (!row) throw new NodeScopeException('SNMP_002', 'OID profile not found', 404);
    const count = await this.repo.countProfileAssignments(id);
    if (count > 0)
      throw new NodeScopeException(
        'SNMP_003',
        'Cannot delete a profile that is still assigned to networks or devices',
        409,
      );
    await this.repo.deleteProfile(id);
  }

  // ─── Assignment (F3-scoped) ───────────────────────────────────────────────

  /**
   * Assign a credential and/or OID profile to a network or device.
   * Credentials/profiles are validated as belonging to the org, and F3 scope
   * is enforced per target type (device → assertCanConfigure; network → assertNetworkFullCoverage).
   */
  async assign(
    member: OrgMemberContext,
    dto: AssignSnmpDto,
  ): Promise<{ targetType: string; targetId: string; snmpCredentialId: string | null; oidProfileId: string | null }> {
    const orgId = member.organizationId;

    // Validate credential belongs to org
    if (dto.snmpCredentialId) {
      const cred = await this.repo.findCredential(orgId, dto.snmpCredentialId);
      if (!cred) throw new NodeScopeException('SNMP_001', 'SNMP credential not found', HttpStatus.NOT_FOUND);
    }

    // Validate profile belongs to org
    if (dto.oidProfileId) {
      const prof = await this.repo.findProfile(orgId, dto.oidProfileId);
      if (!prof) throw new NodeScopeException('SNMP_002', 'OID profile not found', HttpStatus.NOT_FOUND);
    }

    if (dto.targetType === 'device') {
      // Load device org-scoped (no F3 filter — write path, PERM_001 not 404 for out-of-scope)
      const device = await this.prisma.device.findFirst({
        where: { id: dto.targetId, organizationId: orgId },
        select: { id: true, propertyId: true },
      });
      if (!device) {
        throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
      }
      // F3 scope check: ADMIN must be in-scope for the device's governing site
      await this.permissions.assertCanConfigure(member, device.propertyId);

      const updated = await this.prisma.device.update({
        where: { id: dto.targetId },
        data: {
          snmpCredentialId: dto.snmpCredentialId ?? null,
          oidProfileId: dto.oidProfileId ?? null,
        },
        select: { id: true, snmpCredentialId: true, oidProfileId: true },
      });

      return {
        targetType: 'device',
        targetId: updated.id,
        snmpCredentialId: updated.snmpCredentialId,
        oidProfileId: updated.oidProfileId,
      };
    } else {
      // network
      const network = await this.networksRepository.findByIdAndOrgId(dto.targetId, orgId);
      if (!network) {
        throw new NodeScopeException('NETWORK_002', 'NETWORK_NOT_FOUND', HttpStatus.NOT_FOUND);
      }

      // F3 scope check: ADMIN must cover ALL chartered + device-footprint sites
      const coverageSites = [
        ...new Set([
          ...(await this.networksRepository.charteredPropertyIds(orgId, dto.targetId)),
          ...(await this.networksRepository.deviceFootprintPropertyIds(orgId, dto.targetId)),
        ]),
      ];
      await this.permissions.assertNetworkFullCoverage(member, coverageSites);

      const updated = await this.prisma.network.update({
        where: { id: dto.targetId },
        data: {
          snmpCredentialId: dto.snmpCredentialId ?? null,
          oidProfileId: dto.oidProfileId ?? null,
        },
        select: { id: true, snmpCredentialId: true, oidProfileId: true },
      });

      return {
        targetType: 'network',
        targetId: updated.id,
        snmpCredentialId: updated.snmpCredentialId,
        oidProfileId: updated.oidProfileId,
      };
    }
  }

  // ─── Resolution — compute effective SNMP target for a device ─────────────

  /**
   * Compute the effective SNMP credential + OID profile for a device by applying
   * override-wins semantics (device-level > network-level).
   *
   * Returns null when neither the device nor its network has a credential assigned.
   * This is the ONLY place where encrypted secrets are decrypted.
   * The returned DTO must NEVER be persisted or logged.
   */
  async resolveTarget(organizationId: string, deviceId: string): Promise<SnmpTargetDto | null> {
    const ref = await this.resolveCredProf(organizationId, deviceId);
    return ref ? this.buildTarget(organizationId, ref.credId, ref.profId) : null;
  }

  /**
   * Resolve which credential + OID profile a device effectively uses, applying
   * override-wins (device-level beats network-level). Returns null when the device
   * is missing or no credential is assigned anywhere in the chain.
   */
  private async resolveCredProf(
    organizationId: string,
    deviceId: string,
  ): Promise<CredProfRef | null> {
    const device = await this.repo.deviceWithSnmp(organizationId, deviceId);
    if (!device) return null;
    return this.pickCredProf(device);
  }

  /**
   * Override-wins pick over a single loaded device row: the device's own assignment beats
   * its network's default, per field. Pure - the single-device and batch paths MUST share it
   * so the two can never drift into resolving the same device differently.
   */
  private pickCredProf(device: DeviceSnmpRow): CredProfRef | null {
    const credId = device.snmpCredentialId ?? device.network?.snmpCredentialId ?? null;
    if (!credId) return null;
    const profId = device.oidProfileId ?? device.network?.oidProfileId ?? null;
    return { credId, profId };
  }

  /**
   * Fetch the credential + profile and assemble the target.
   */
  private async buildTarget(
    organizationId: string,
    credId: string,
    profId: string | null,
  ): Promise<SnmpTargetDto | null> {
    const cred = await this.repo.findCredential(organizationId, credId);
    if (!cred) return null;
    const profile = profId ? await this.repo.findProfile(organizationId, profId) : null;
    return this.assembleTarget(cred, profile);
  }

  /**
   * Assemble the wire target from an already-loaded credential + profile. The ONLY place
   * encrypted secrets are decrypted; the returned DTO must NEVER be persisted or logged.
   *
   * A profile id that resolves to no row is treated exactly like no profile at all
   * (empty OID list, no interface metrics) - a missing profile never suppresses the target.
   */
  private assembleTarget(
    cred: SnmpCredential,
    profile: (OidProfile & { entries: OidEntry[] }) | null,
  ): SnmpTargetDto {
    const dec = (b: string | null): string | undefined => (b ? this.crypto.decrypt(b) : undefined);

    return {
      version: cred.snmpVersion as 'V2C' | 'V3',
      community: dec(cred.communityEnc),
      securityName: cred.securityName ?? undefined,
      securityLevel: cred.securityLevel ?? undefined,
      authProtocol: cred.authProtocol ?? undefined,
      authKey: dec(cred.authKeyEnc),
      privProtocol: cred.privProtocol ?? undefined,
      privKey: dec(cred.privKeyEnc),
      oids: profile ? profile.entries.map((e) => ({ oid: e.oid, metric: e.metric })) : [],
      interfaceMetrics: profile ? profile.includeInterfaceMetrics : false,
    };
  }

  /**
   * Attach the resolved SNMP target to each device in the list, returning a new
   * array with `snmp` populated where a credential is resolved (or omitted if null).
   * Designed for use in the agent device-sync payload (Phase C Task 3).
   *
   * The list here is the agent's ENTIRE org fleet, polled on a schedule, so the work per
   * device must not be a query. Everything is loaded up front in a bounded number of round
   * trips - devices, then the distinct credentials and profiles they reference - and each
   * device is then resolved in memory. A per-device query would fan out one concurrent
   * Prisma call per device from a single request, drain the API-wide connection pool, and
   * take every other request and socket push down with it (P2024).
   *
   * A credential+profile pair shared by many devices is assembled - and its secrets
   * decrypted - ONCE per call; decryption is the costly part.
   */
  async attachTargets(organizationId: string, devices: AgentDeviceDto[]): Promise<AgentDeviceDto[]> {
    if (devices.length === 0) return [];

    // Devices absent from the result (deleted, or belonging to another org) get no ref and
    // therefore no `snmp` - identical to the per-device path, which org-scoped every load.
    const rows = await this.repo.devicesWithSnmp(organizationId, devices.map((d) => d.id));
    const refByDeviceId = new Map<string, CredProfRef>();
    for (const row of rows) {
      const ref = this.pickCredProf(row);
      if (ref) refByDeviceId.set(row.id, ref);
    }

    const credIds = new Set<string>();
    const profIds = new Set<string>();
    for (const ref of refByDeviceId.values()) {
      credIds.add(ref.credId);
      if (ref.profId) profIds.add(ref.profId);
    }

    // Both loads stay org-scoped, so a dangling assignment can never leak another org's
    // credential into this org's payload: an id that does not resolve within the org is
    // treated as absent, exactly as the org-scoped findCredential/findProfile were.
    const [creds, profiles] = await Promise.all([
      this.repo.findCredentialsByIds(organizationId, [...credIds]),
      this.repo.findProfilesByIds(organizationId, [...profIds]),
    ]);
    const credById = new Map(creds.map((c) => [c.id, c]));
    const profById = new Map(profiles.map((p) => [p.id, p]));

    const targetCache = new Map<string, SnmpTargetDto | null>();
    const targetFor = (ref: CredProfRef): SnmpTargetDto | null => {
      const key = `${ref.credId}:${ref.profId ?? ''}`;
      let target = targetCache.get(key);
      if (target === undefined) {
        const cred = credById.get(ref.credId);
        const profile = ref.profId ? (profById.get(ref.profId) ?? null) : null;
        target = cred ? this.assembleTarget(cred, profile) : null;
        targetCache.set(key, target);
      }
      return target;
    };

    return devices.map((d) => {
      const ref = refByDeviceId.get(d.id);
      const snmp = ref ? targetFor(ref) : null;
      return snmp ? { ...d, snmp } : { ...d };
    });
  }

  // ─── Mappers — secrets NEVER exposed ──────────────────────────────────────

  private toCredDto(r: SnmpCredential): SnmpCredentialDto {
    return {
      id: r.id,
      organizationId: r.organizationId,
      name: r.name,
      snmpVersion: r.snmpVersion,
      securityLevel: r.securityLevel,
      securityName: r.securityName,
      authProtocol: r.authProtocol,
      privProtocol: r.privProtocol,
      hasCommunity: r.communityEnc !== null,
      hasAuthKey: r.authKeyEnc !== null,
      hasPrivKey: r.privKeyEnc !== null,
      version: r.version,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private toProfileDto(r: OidProfile & { entries: OidEntry[] }): OidProfileDto {
    return {
      id: r.id,
      organizationId: r.organizationId,
      name: r.name,
      includeInterfaceMetrics: r.includeInterfaceMetrics,
      entries: r.entries.map((e) => ({ id: e.id, oid: e.oid, metric: e.metric })),
      version: r.version,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private toProfileSummaryDto(r: OidProfile): OidProfileSummaryDto {
    return {
      id: r.id,
      organizationId: r.organizationId,
      name: r.name,
      includeInterfaceMetrics: r.includeInterfaceMetrics,
      version: r.version,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
