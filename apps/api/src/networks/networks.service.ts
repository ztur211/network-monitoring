import { HttpStatus, Injectable } from '@nestjs/common';
import { Network } from '@prisma/client';
import {
  NetworkDetail,
  NetworkSummary,
  WS_EVENTS,
} from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';
import {
  CreateNetworkDto,
  NETWORK_WRITABLE_FIELDS,
  PatchNetworkDto,
} from './networks.dto';
import { NetworksRepository } from './networks.repository';

const MAX_NETWORKS_PER_USER = 1;

@Injectable()
export class NetworksService {
  constructor(
    private readonly networksRepository: NetworksRepository,
    private readonly conflictService: ConflictResolutionService,
  ) {}

  async listNetworks(userId: string): Promise<NetworkSummary[]> {
    const networks = await this.networksRepository.findAllByUserId(userId);
    return networks.map((n) => this.toSummary(n));
  }

  async createNetwork(userId: string, dto: CreateNetworkDto): Promise<NetworkDetail> {
    const existingCount = await this.networksRepository.countByUserId(userId);
    if (existingCount >= MAX_NETWORKS_PER_USER) {
      throw new NodeScopeException(
        'NETWORK_001',
        'NETWORK_LIMIT_EXCEEDED',
        HttpStatus.CONFLICT,
      );
    }

    const network = await this.networksRepository.create({ userId, ...dto });
    const detail = this.toDetail(network);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.NETWORK_UPDATED,
      { networkId: network.id, network: detail },
      userId,
    );
    return detail;
  }

  async getNetwork(userId: string, networkId: string): Promise<NetworkDetail> {
    const network = await this.networksRepository.findByIdAndUserId(networkId, userId);
    if (!network) {
      throw new NodeScopeException('NETWORK_002', 'NETWORK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.toDetail(network);
  }

  async updateNetwork(
    userId: string,
    networkId: string,
    patch: PatchNetworkDto,
  ): Promise<NetworkDetail> {
    const network = await this.networksRepository.findByIdAndUserId(networkId, userId);
    if (!network) {
      throw new NodeScopeException('NETWORK_002', 'NETWORK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const updatePayload = this.conflictService.buildUpdatePayload(
      patch,
      NETWORK_WRITABLE_FIELDS,
      network.version,
    );

    const updated = await this.networksRepository.updateWithVersion(
      networkId,
      userId,
      updatePayload,
      patch.baseVersion,
    );
    if (!updated) {
      throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
    }

    const detail = this.toDetail(updated);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.NETWORK_UPDATED,
      { networkId, network: detail, changes: patch.changes, updatedBy: userId },
      userId,
    );
    return detail;
  }

  async deleteNetwork(userId: string, networkId: string): Promise<void> {
    const network = await this.networksRepository.findByIdAndUserId(networkId, userId);
    if (!network) {
      throw new NodeScopeException('NETWORK_002', 'NETWORK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    await this.networksRepository.deleteByIdAndUserId(networkId, userId);
  }

  async checkOnHome(
    userId: string,
    requestIp: string,
  ): Promise<{ networkId: string | null; onHome: boolean }> {
    const networks = await this.networksRepository.findAllByUserId(userId);
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
