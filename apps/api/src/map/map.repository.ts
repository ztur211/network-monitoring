import { Injectable } from '@nestjs/common';
import { Device, FiberRun, Circuit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type BboxCoords = {
  west: number;
  south: number;
  east: number;
  north: number;
};

// The Device table has a `location geometry(Point, 4326)` column added by raw
// SQL migration that Prisma's schema doesn't know about. `$queryRaw` returning
// `d.*` therefore tries to deserialize geometry and throws — we must list
// every Prisma-tracked column explicitly. Keep this in sync with schema.prisma:
// any new Device column must be added here, or it returns as `undefined` on the
// map payload (the cast to Device[] makes the omission silent).
const DEVICE_COLUMNS = `
  d.id, d."organizationId", d."userId", d."networkId", d."propertyId", d."roleCode",
  d.name, d.category, d.mobility,
  d.latitude, d.longitude, d.floor, d."floorLabel",
  d."ipAddress", d."macAddress", d.notes, d.version, d."createdAt", d."updatedAt"
`;

@Injectable()
export class MapRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDevicesInBbox(organizationId: string, bbox: BboxCoords, floor?: number): Promise<Device[]> {
    const { west, south, east, north } = bbox;

    if (floor !== undefined) {
      return this.prisma.$queryRawUnsafe<Device[]>(
        `SELECT ${DEVICE_COLUMNS}
         FROM "Device" d
         WHERE d."organizationId" = $1
           AND d.location IS NOT NULL
           AND d.floor = $2
           AND ST_Within(
             d.location,
             ST_MakeEnvelope($3, $4, $5, $6, 4326)
           )
         ORDER BY d."createdAt" DESC`,
        organizationId,
        floor,
        west,
        south,
        east,
        north,
      );
    }

    return this.prisma.$queryRawUnsafe<Device[]>(
      `SELECT ${DEVICE_COLUMNS}
       FROM "Device" d
       WHERE d."organizationId" = $1
         AND d.location IS NOT NULL
         AND ST_Within(
           d.location,
           ST_MakeEnvelope($2, $3, $4, $5, 4326)
         )
       ORDER BY d."createdAt" DESC`,
      organizationId,
      west,
      south,
      east,
      north,
    );
  }

  findFiberRunsInBbox(organizationId: string, bbox: BboxCoords): Promise<FiberRun[]> {
    const { west, south, east, north } = bbox;

    return this.prisma.$queryRaw<FiberRun[]>`
      SELECT DISTINCT fr.*
      FROM "FiberRun" fr
      JOIN "Device" d1 ON fr."startDeviceId" = d1.id
      JOIN "Device" d2 ON fr."endDeviceId" = d2.id
      WHERE fr."organizationId" = ${organizationId}
        AND (
          (d1.location IS NOT NULL AND ST_Within(d1.location, ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)))
          OR
          (d2.location IS NOT NULL AND ST_Within(d2.location, ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)))
        )
      ORDER BY fr."createdAt" DESC
    `;
  }

  findCircuitsInBbox(organizationId: string, bbox: BboxCoords): Promise<Circuit[]> {
    const { west, south, east, north } = bbox;

    return this.prisma.$queryRaw<Circuit[]>`
      SELECT c.*
      FROM "Circuit" c
      JOIN "Device" d ON c."deviceId" = d.id
      WHERE c."organizationId" = ${organizationId}
        AND d.location IS NOT NULL
        AND ST_Within(
          d.location,
          ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)
        )
      ORDER BY c."createdAt" DESC
    `;
  }
}
