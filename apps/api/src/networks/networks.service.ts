import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Network } from '@prisma/client';
import {
  NetworkDetail,
  NetworkSummary,
  WS_EVENTS,
} from '@nodescope/shared';
import { AuditService } from '../audit/audit.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { PermissionsService } from '../permissions/permissions.service';
import { IRealtimeService, REALTIME_SERVICE } from '../realtime/realtime.types';
import {
  CreateNetworkDto,
  NETWORK_WRITABLE_FIELDS,
  PatchNetworkDto,
} from './networks.dto';
import { NetworksRepository } from './networks.repository';

const MAX_NETWORKS_PER_ORG = 1;

@Injectable()
export class NetworksService {
  constructor(
    private readonly networksRepository: NetworksRepository,
    private readonly conflictService: ConflictResolutionService,
    @Inject(REALTIME_SERVICE) private readonly realtimeService: IRealtimeService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  async listNetworks(member: OrgMemberContext): Promise<NetworkSummary[]> {
    const scope = await this.permissions.scopeFilter(member);
    const networks = await this.networksRepository.listVisible(member.organizationId, scope);
    return networks.map((n) => this.toSummary(n));
  }

  async createNetwork(
    member: OrgMemberContext,
    creatorUserId: string,
    dto: CreateNetworkDto,
  ): Promise<NetworkDetail> {
    // No charters yet on create — just the role gate
    await this.permissions.assertNetworkFullCoverage(member, []);
    const organizationId = member.organizationId;

    const existingCount = await this.networksRepository.countByOrgId(organizationId);
    if (existingCount >= MAX_NETWORKS_PER_ORG) {
      throw new NodeScopeException(
        'NETWORK_001',
        'NETWORK_LIMIT_EXCEEDED',
        HttpStatus.CONFLICT,
      );
    }

    const network = await this.networksRepository.create({
      organizationId,
      userId: creatorUserId,
      ...dto,
    });
    await this.audit.recordCreate(organizationId, 'Network', network);
    const detail = this.toDetail(network);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.NETWORK_UPDATED,
      { networkId: network.id, network: detail },
      organizationId,
    );
    return detail;
  }

  async getNetwork(member: OrgMemberContext, networkId: string): Promise<NetworkDetail> {
    const scope = await this.permissions.scopeFilter(member);
    const network = await this.networksRepository.findVisibleByIdAndOrgId(
      networkId,
      member.organizationId,
      scope,
    );
    if (!network) {
      throw new NodeScopeException('NETWORK_002', 'NETWORK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.toDetail(network);
  }

  async updateNetwork(
    member: OrgMemberContext,
    networkId: string,
    patch: PatchNetworkDto,
  ): Promise<NetworkDetail> {
    const organizationId = member.organizationId;
    // Write path: org-wide lookup so out-of-scope ADMIN → PERM_004 not 404
    const network = await this.networksRepository.findByIdAndOrgId(networkId, organizationId);
    if (!network) {
      throw new NodeScopeException('NETWORK_002', 'NETWORK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const charteredIds = await this.networksRepository.charteredPropertyIds(organizationId, networkId);
    await this.permissions.assertNetworkFullCoverage(member, charteredIds);

    const updatePayload = this.conflictService.buildUpdatePayload(
      patch,
      NETWORK_WRITABLE_FIELDS,
      network.version,
      CreateNetworkDto,
    );

    const updated = await this.networksRepository.updateWithVersion(
      networkId,
      organizationId,
      updatePayload,
      patch.baseVersion,
    );
    if (!updated) {
      throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
    }

    const detail = this.toDetail(updated);
    await this.audit.recordUpdate(organizationId, 'Network', networkId, patch.changes);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.NETWORK_UPDATED,
      { networkId, network: detail, changes: patch.changes, updatedBy: updated.userId ?? '' },
      organizationId,
    );

    if (patch.changes.some((c) => c.field === 'homePublicIp')) {
      void this.realtimeService.recomputeOnHomeForUser(updated.userId ?? '');
    }

    return detail;
  }

  async setHomeIpFromRequest(
    member: OrgMemberContext,
    networkId: string,
    requestIp: string,
  ): Promise<NetworkDetail> {
    // Org-wide lookup to get the version for the changeset (coverage check runs inside updateNetwork)
    const organizationId = member.organizationId;
    const network = await this.networksRepository.findByIdAndOrgId(networkId, organizationId);
    if (!network) {
      throw new NodeScopeException('NETWORK_002', 'NETWORK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.updateNetwork(member, networkId, {
      baseVersion: network.version,
      changes: [
        {
          field: 'homePublicIp',
          oldValue: network.homePublicIp,
          newValue: requestIp,
        },
      ],
    });
  }

  async deleteNetwork(member: OrgMemberContext, networkId: string): Promise<void> {
    const organizationId = member.organizationId;
    // Write path: org-wide lookup so out-of-scope ADMIN → PERM_004 not 404
    const network = await this.networksRepository.findByIdAndOrgId(networkId, organizationId);
    if (!network) {
      throw new NodeScopeException('NETWORK_002', 'NETWORK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    const charteredIds = await this.networksRepository.charteredPropertyIds(organizationId, networkId);
    await this.permissions.assertNetworkFullCoverage(member, charteredIds);
    await this.networksRepository.deleteByIdAndOrgId(networkId, organizationId);
    await this.audit.recordDelete(organizationId, 'Network', network);
  }

  /**
   * Called by the realtime gateway (which only knows userId, not organizationId).
   * Looks up the user's org's first network via org membership and checks whether
   * the request IP matches the network's homePublicIp.
   */
  async checkOnHome(
    userId: string,
    requestIp: string,
  ): Promise<{ networkId: string | null; onHome: boolean }> {
    const networks = await this.networksRepository.findAllByMemberUserId(userId);
    const network = networks[0] ?? null;
    if (!network) return { networkId: null, onHome: false };

    const onHome =
      requestIp.length > 0 &&
      network.homePublicIp !== null &&
      network.homePublicIp === requestIp;
    return { networkId: network.id, onHome };
  }

  private toSummary(network: Network): NetworkSummary {
    return {
      id: network.id,
      name: network.name,
      homeAddress: network.homeAddress,
      homeLatitude: network.homeLatitude,
      homeLongitude: network.homeLongitude,
      isp: network.isp,
      downMbps: network.downMbps,
      upMbps: network.upMbps,
      version: network.version,
      createdAt: network.createdAt.toISOString(),
      updatedAt: network.updatedAt.toISOString(),
    };
  }

  private toDetail(network: Network): NetworkDetail {
    return { ...this.toSummary(network), homePublicIp: network.homePublicIp };
  }
}
