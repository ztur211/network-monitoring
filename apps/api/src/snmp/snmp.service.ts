import { Injectable } from '@nestjs/common';
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
import { SnmpRepository } from './snmp.repository';

@Injectable()
export class SnmpService {
  constructor(
    private readonly repo: SnmpRepository,
    private readonly crypto: CryptoService,
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
    // createProfile returns OidProfile without entries populated; re-fetch for full DTO
    const full = await this.repo.findProfile(organizationId, row.id);
    return this.toProfileDto(full!);
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
