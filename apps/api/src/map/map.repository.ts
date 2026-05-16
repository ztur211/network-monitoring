import { Injectable } from '@nestjs/common';
import { Device, FiberRun, Circuit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type BboxCoords = {
  west: number;
  south: number;
  east: number;
  north: number;
};

@Injectable()
export class MapRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDevicesInBbox(userId: string, bbox: BboxCoords, floor?: number): Promise<Device[]> {
    const { west, south, east, north } = bbox;

    if (floor !== undefined) {
      return this.prisma.$queryRaw<Device[]>`
        SELECT d.*
        FROM "Device" d
        WHERE d."userId" = ${userId}
          AND d.location IS NOT NULL
          AND d.floor = ${floor}
          AND ST_Within(
            d.location,
            ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)
          )
        ORDER BY d."createdAt" DESC
      `;
    }

    return this.prisma.$queryRaw<Device[]>`
      SELECT d.*
      FROM "Device" d
      WHERE d."userId" = ${userId}
        AND d.location IS NOT NULL
        AND ST_Within(
          d.location,
          ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)
        )
      ORDER BY d."createdAt" DESC
    `;
  }

  findFiberRunsInBbox(userId: string, bbox: BboxCoords): Promise<FiberRun[]> {
    const { west, south, east, north } = bbox;

    return this.prisma.$queryRaw<FiberRun[]>`
      SELECT DISTINCT fr.*
      FROM "FiberRun" fr
      JOIN "Device" d1 ON fr."startDeviceId" = d1.id
      JOIN "Device" d2 ON fr."endDeviceId" = d2.id
      WHERE fr."userId" = ${userId}
        AND (
          (d1.location IS NOT NULL AND ST_Within(d1.location, ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)))
          OR
          (d2.location IS NOT NULL AND ST_Within(d2.location, ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)))
        )
      ORDER BY fr."createdAt" DESC
    `;
  }

  findCircuitsInBbox(userId: string, bbox: BboxCoords): Promise<Circuit[]> {
    const { west, south, east, north } = bbox;

    return this.prisma.$queryRaw<Circuit[]>`
      SELECT c.*
      FROM "Circuit" c
      JOIN "Device" d ON c."deviceId" = d.id
      WHERE c."userId" = ${userId}
        AND d.location IS NOT NULL
        AND ST_Within(
          d.location,
          ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)
        )
      ORDER BY c."createdAt" DESC
    `;
  }
}
