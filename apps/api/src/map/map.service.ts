import { HttpStatus, Injectable } from '@nestjs/common';
import { Device, FiberRun, Circuit } from '@prisma/client';
import { DeviceDto, FiberRunDto, CircuitDto } from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { MapRepository } from './map.repository';

type BboxCoords = { west: number; south: number; east: number; north: number };

@Injectable()
export class MapService {
  constructor(private readonly mapRepository: MapRepository) {}

  async getDevicesInBbox(
    userId: string,
    bbox: string,
    floor?: number,
  ): Promise<{ items: DeviceDto[] }> {
    const coords = this.parseBbox(bbox);
    const devices = await this.mapRepository.findDevicesInBbox(userId, coords, floor);
    return { items: devices.map((d) => this.deviceToDto(d)) };
  }

  async getFiberRunsInBbox(userId: string, bbox: string): Promise<{ items: FiberRunDto[] }> {
    const coords = this.parseBbox(bbox);
    const runs = await this.mapRepository.findFiberRunsInBbox(userId, coords);
    return { items: runs.map((r) => this.fiberRunToDto(r)) };
  }

  async getCircuitsInBbox(userId: string, bbox: string): Promise<{ items: CircuitDto[] }> {
    const coords = this.parseBbox(bbox);
    const circuits = await this.mapRepository.findCircuitsInBbox(userId, coords);
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

  private deviceToDto(device: Device): DeviceDto {
    return {
      id: device.id,
      userId: device.userId,
      name: device.name,
      category: device.category,
      latitude: device.latitude,
      longitude: device.longitude,
      floor: device.floor,
      floorLabel: device.floorLabel,
      ipAddress: device.ipAddress,
      macAddress: device.macAddress,
      notes: device.notes,
      version: device.version,
      createdAt: device.createdAt.toISOString(),
      updatedAt: device.updatedAt.toISOString(),
    };
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
