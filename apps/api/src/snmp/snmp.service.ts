import { HttpStatus, Injectable } from '@nestjs/common';
import type { SnmpCredential, OidProfile, OidEntry } from '@prisma/client';
import type {
  SnmpCredentialDto,
  CreateSnmpCredentialDto,
  OidProfileDto,
  OidProfileSummaryDto,
  CreateOidProfileDto,
} from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { CryptoService } from '../common/crypto/crypto.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { NetworksRepository } from '../networks/networks.repository';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { SnmpRepository } from './snmp.repository';
import type { AssignSnmpDto } from './snmp.dto';

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
