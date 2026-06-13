import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Network } from '@prisma/client';
import {
  NetworkDetail,
  NetworkSummary,
  WS_EVENTS,
} from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';
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
  ) {}

  async listNetworks(organizationId: string): Promise<NetworkSummary[]> {
    const networks = await this.networksRepository.findAllByOrgId(organizationId);
    return networks.map((n) => this.toSummary(n));
  }

  async createNetwork(
    organizationId: string,
    creatorUserId: string,
    dto: CreateNetworkDto,
  ): Promise<NetworkDetail> {
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
    const detail = this.toDetail(network);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.NETWORK_UPDATED,
      { networkId: network.id, network: detail },
      network.userId ?? '',
    );
    return detail;
  }

  async getNetwork(organizationId: string, networkId: string): Promise<NetworkDetail> {
    const network = await this.networksRepository.findByIdAndOrgId(networkId, organizationId);
    if (!network) {
      throw new NodeScopeException('NETWORK_002', 'NETWORK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.toDetail(network);
  }

  async updateNetwork(
    organizationId: string,
    networkId: string,
    patch: PatchNetworkDto,
  ): Promise<NetworkDetail> {
    const network = await this.networksRepository.findByIdAndOrgId(networkId, organizationId);
    if (!network) {
      throw new NodeScopeException('NETWORK_002', 'NETWORK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

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
    this.conflictService.emitEntityEvent(
      WS_EVENTS.NETWORK_UPDATED,
      { networkId, network: detail, changes: patch.changes, updatedBy: updated.userId ?? '' },
      updated.userId ?? '',
    );

    if (patch.changes.some((c) => c.field === 'homePublicIp')) {
      void this.realtimeService.recomputeOnHomeForUser(updated.userId ?? '');
    }

    return detail;
  }

  async setHomeIpFromRequest(
    organizationId: string,
    networkId: string,
    requestIp: string,
  ): Promise<NetworkDetail> {
    const network = await this.networksRepository.findByIdAndOrgId(networkId, organizationId);
    if (!network) {
      throw new NodeScopeException('NETWORK_002', 'NETWORK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.updateNetwork(organizationId, networkId, {
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

  async deleteNetwork(organizationId: string, networkId: string): Promise<void> {
    const network = await this.networksRepository.findByIdAndOrgId(networkId, organizationId);
    if (!network) {
      throw new NodeScopeException('NETWORK_002', 'NETWORK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    await this.networksRepository.deleteByIdAndOrgId(networkId, organizationId);
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
