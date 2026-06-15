import { Injectable } from '@nestjs/common';
import { BuildingModel, BuildingModelVersion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * DB access for building models + their immutable versions (Spec 1). Every query is
 * org-scoped (Rule #2: only repositories touch Prisma). Activation/version mechanics
 * (audit, events, storage) live in the Phase B service that consumes this surface.
 */
@Injectable()
export class BuildingModelsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createModel(data: {
    organizationId: string;
    propertyId: string;
    name: string;
  }): Promise<BuildingModel> {
    return this.prisma.buildingModel.create({ data });
  }

  findByProperty(organizationId: string, propertyId: string): Promise<BuildingModel | null> {
    return this.prisma.buildingModel.findFirst({ where: { organizationId, propertyId } });
  }

  findModelById(organizationId: string, id: string): Promise<BuildingModel | null> {
    return this.prisma.buildingModel.findFirst({ where: { id, organizationId } });
  }

  async nextVersionNumber(organizationId: string, buildingModelId: string): Promise<number> {
    const last = await this.prisma.buildingModelVersion.findFirst({
      where: { organizationId, buildingModelId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    return (last?.versionNumber ?? 0) + 1;
  }

  createVersion(data: {
    organizationId: string;
    buildingModelId: string;
    versionNumber: number;
    storageKey: string;
    fileName: string;
    contentHash: string;
    sizeBytes: number;
    units: string | null;
    uploadedByMemberId: string | null;
  }): Promise<BuildingModelVersion> {
    return this.prisma.buildingModelVersion.create({ data });
  }

  listVersions(organizationId: string, buildingModelId: string): Promise<BuildingModelVersion[]> {
    return this.prisma.buildingModelVersion.findMany({
      where: { organizationId, buildingModelId },
      orderBy: { versionNumber: 'desc' },
    });
  }

  findVersion(organizationId: string, versionId: string): Promise<BuildingModelVersion | null> {
    return this.prisma.buildingModelVersion.findFirst({ where: { id: versionId, organizationId } });
  }

  /** Optimistic repoint of the active version. Returns false on a version conflict. */
  async setActiveVersion(
    organizationId: string,
    modelId: string,
    versionId: string,
    expectedVersion: number,
  ): Promise<boolean> {
    const r = await this.prisma.buildingModel.updateMany({
      where: { id: modelId, organizationId, version: expectedVersion },
      data: { activeVersionId: versionId, version: { increment: 1 } },
    });
    return r.count > 0;
  }

  deleteVersion(organizationId: string, versionId: string): Promise<{ count: number }> {
    return this.prisma.buildingModelVersion.deleteMany({ where: { id: versionId, organizationId } });
  }
}
