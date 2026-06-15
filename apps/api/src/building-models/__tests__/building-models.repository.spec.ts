import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { BuildingModelsRepository } from '../building-models.repository';

describe('BuildingModelsRepository (integration)', () => {
  let repo: BuildingModelsRepository;
  let prisma: PrismaService;
  let orgId: string;
  let buildingId: string;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      providers: [BuildingModelsRepository, PrismaService],
    }).compile();
    repo = ref.get(BuildingModelsRepository);
    prisma = ref.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: `BM${Date.now()}${Math.round(performance.now())}` },
    });
    orgId = org.id;
    const site = await prisma.property.create({
      data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'S' },
    });
    const bld = await prisma.property.create({
      data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'B' },
    });
    buildingId = bld.id;
  });

  afterEach(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it('creates a model, adds versions with incrementing numbers, sets active, blocks dup building', async () => {
    const model = await repo.createModel({ organizationId: orgId, propertyId: buildingId, name: 'B' });
    const v1 = await repo.createVersion({
      organizationId: orgId, buildingModelId: model.id, versionNumber: 1,
      storageKey: 'k1', fileName: 'a.ifc', contentHash: 'h1', sizeBytes: 10, units: 'METRE', uploadedByMemberId: null,
    });
    const ok = await repo.setActiveVersion(orgId, model.id, v1.id, model.version);
    expect(ok).toBe(true);

    const reloaded = await repo.findByProperty(orgId, buildingId);
    expect(reloaded?.activeVersionId).toBe(v1.id);
    expect(await repo.nextVersionNumber(orgId, model.id)).toBe(2);

    // propertyId is @unique → a second model for the same building is rejected (P2002)
    await expect(
      repo.createModel({ organizationId: orgId, propertyId: buildingId, name: 'dup' }),
    ).rejects.toThrow();
  });

  it('lists versions newest-first, finds a version, and deletes a non-active version', async () => {
    const model = await repo.createModel({ organizationId: orgId, propertyId: buildingId, name: 'B' });
    const v1 = await repo.createVersion({
      organizationId: orgId, buildingModelId: model.id, versionNumber: 1,
      storageKey: 'k1', fileName: 'a.ifc', contentHash: 'h1', sizeBytes: 10, units: null, uploadedByMemberId: null,
    });
    const v2 = await repo.createVersion({
      organizationId: orgId, buildingModelId: model.id, versionNumber: 2,
      storageKey: 'k2', fileName: 'b.ifc', contentHash: 'h2', sizeBytes: 20, units: null, uploadedByMemberId: null,
    });

    const versions = await repo.listVersions(orgId, model.id);
    expect(versions.map((v) => v.versionNumber)).toEqual([2, 1]);
    expect((await repo.findVersion(orgId, v1.id))?.storageKey).toBe('k1');

    const del = await repo.deleteVersion(orgId, v2.id);
    expect(del.count).toBe(1);
    expect(await repo.findVersion(orgId, v2.id)).toBeNull();
  });

  it('scopes reads to the organization (cross-org isolation)', async () => {
    const model = await repo.createModel({ organizationId: orgId, propertyId: buildingId, name: 'B' });
    expect(await repo.findModelById('some-other-org', model.id)).toBeNull();
  });
});
