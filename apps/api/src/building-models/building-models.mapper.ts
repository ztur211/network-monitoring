import { BuildingModel, BuildingModelVersion } from '@prisma/client';
import { BuildingModelDto, BuildingModelVersionDto } from '@nodescope/shared';

/** Pure row→DTO mappers. The version DTO omits `storageKey` (internal — Spec 1 §10.1). */
export function toBuildingModelDto(m: BuildingModel): BuildingModelDto {
  return {
    id: m.id,
    organizationId: m.organizationId,
    propertyId: m.propertyId,
    name: m.name,
    activeVersionId: m.activeVersionId,
    version: m.version,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export function toVersionDto(v: BuildingModelVersion): BuildingModelVersionDto {
  return {
    id: v.id,
    buildingModelId: v.buildingModelId,
    versionNumber: v.versionNumber,
    fileName: v.fileName,
    contentHash: v.contentHash,
    sizeBytes: v.sizeBytes,
    units: v.units,
    uploadedByMemberId: v.uploadedByMemberId,
    createdAt: v.createdAt.toISOString(),
  };
}
