import { HttpStatus, Injectable } from '@nestjs/common';
import { FiberRun, Circuit } from '@prisma/client';
import { DeviceDto, FiberRunDto, CircuitDto } from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { OrgMemberContext } from '../organizations/org-context.types';
import { PermissionsService } from '../permissions/permissions.service';
import { MapRepository } from './map.repository';
import { toDeviceDto } from '../devices/device.mapper';

type BboxCoords = { west: number; south: number; east: number; north: number };

@Injectable()
export class MapService {
  constructor(
    private readonly mapRepository: MapRepository,
    private readonly permissions: PermissionsService,
  ) {}

  async getDevicesInBbox(
    member: OrgMemberContext,
    bbox: string,
    floor?: number,
  ): Promise<{ items: DeviceDto[] }> {
    const coords = this.parseBbox(bbox);
    const scope = await this.permissions.scopeFilter(member);
    const scopeIds = scope ? scope.propertyIdIn : null;
    const devices = await this.mapRepository.findDevicesInBbox(member.organizationId, coords, floor, scopeIds);
    return { items: devices.map((d) => toDeviceDto(d)) };
  }

  async getFiberRunsInBbox(member: OrgMemberContext, bbox: string): Promise<{ items: FiberRunDto[] }> {
    const coords = this.parseBbox(bbox);
    const scope = await this.permissions.scopeFilter(member);
    const scopeIds = scope ? scope.propertyIdIn : null;
    const runs = await this.mapRepository.findFiberRunsInBbox(member.organizationId, coords, scopeIds);
    return { items: runs.map((r) => this.fiberRunToDto(r)) };
  }

  async getCircuitsInBbox(member: OrgMemberContext, bbox: string): Promise<{ items: CircuitDto[] }> {
    const coords = this.parseBbox(bbox);
    const scope = await this.permissions.scopeFilter(member);
    const scopeIds = scope ? scope.propertyIdIn : null;
    const circuits = await this.mapRepository.findCircuitsInBbox(member.organizationId, coords, scopeIds);
    return { items: circuits.map((c) => this.circuitToDto(c)) };
  }

  private parseBbox(bbox: string): BboxCoords {
    const parts = bbox.split(',').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      throw new NodeScopeException('GEN_001', 'Invalid bbox format', HttpStatus.BAD_REQUEST);
    }
    const [west, south, east, north] = parts;
    if (west < -180 || west > 180 || east < -180 || east > 180) {
      throw new NodeScopeException('GEN_001', 'Longitude out of range', HttpStatus.BAD_REQUEST);
    }
    if (south < -90 || south > 90 || north < -90 || north > 90) {
      throw new NodeScopeException('GEN_001', 'Latitude out of range', HttpStatus.BAD_REQUEST);
    }
    return { west, south, east, north };
  }

  private fiberRunToDto(run: FiberRun): FiberRunDto {
    return {
      id: run.id,
      userId: run.userId,
      name: run.name,
      startDeviceId: run.startDeviceId,
      endDeviceId: run.endDeviceId,
      cableType: run.cableType,
      lengthMeters: run.lengthMeters,
      notes: run.notes,
      version: run.version,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  private circuitToDto(circuit: Circuit): CircuitDto {
    return {
      id: circuit.id,
      userId: circuit.userId,
      ispName: circuit.ispName,
      circuitId: circuit.circuitId,
      serviceType: circuit.serviceType,
      bandwidth: circuit.bandwidth,
      deviceId: circuit.deviceId,
      notes: circuit.notes,
      version: circuit.version,
      createdAt: circuit.createdAt.toISOString(),
      updatedAt: circuit.updatedAt.toISOString(),
    };
  }
}
