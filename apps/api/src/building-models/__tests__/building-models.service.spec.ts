import { Test } from '@nestjs/testing';
import { BuildingModelsService } from '../building-models.service';
import { BuildingModelsRepository } from '../building-models.repository';
import { StorageService } from '../../storage/storage.service';
import { PropertiesService } from '../../properties/properties.service';
import { AuditService } from '../../audit/audit.service';
import { REALTIME_SERVICE } from '../../realtime/realtime.types';
import type { OrgMemberContext } from '../../organizations/org-context.types';

const owner = { id: 'mem-o', organizationId: 'org', role: 'OWNER' } as OrgMemberContext;
const model = { id: 'm', organizationId: 'org', propertyId: 'b', name: 'B', activeVersionId: 'vACTIVE', version: 3, createdAt: new Date(), updatedAt: new Date() };

describe('BuildingModelsService (unit)', () => {
  let service: BuildingModelsService;
  const repo = {
    findByProperty: jest.fn(), findVersion: jest.fn(), setActiveVersion: jest.fn(),
    deleteVersion: jest.fn(), listVersions: jest.fn(),
  } as any;
  const storage = { deleteObject: jest.fn() } as any;
  const properties = { findInOrg: jest.fn() } as any;
  const audit = { recordCreate: jest.fn(), recordDelete: jest.fn(), recordUpdate: jest.fn() } as any;
  const realtime = { pushToOrg: jest.fn() } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const ref = await Test.createTestingModule({
      providers: [
        BuildingModelsService,
        { provide: BuildingModelsRepository, useValue: repo },
        { provide: StorageService, useValue: storage },
        { provide: PropertiesService, useValue: properties },
        { provide: AuditService, useValue: audit },
        { provide: REALTIME_SERVICE, useValue: realtime },
      ],
    }).compile();
    service = ref.get(BuildingModelsService);
  });

  it('getModel throws MODEL_001 when no model exists', async () => {
    repo.findByProperty.mockResolvedValue(null);
    await expect(service.getModel(owner, 'b')).rejects.toMatchObject({ code: 'MODEL_001' });
  });

  it('activateVersion repoints active, emits, and returns the DTO (no storageKey leak)', async () => {
    repo.findByProperty.mockResolvedValue(model);
    repo.findVersion.mockResolvedValue({ id: 'v1', buildingModelId: 'm', organizationId: 'org', storageKey: 'k1' });
    repo.setActiveVersion.mockResolvedValue(true);

    const dto = await service.activateVersion(owner, 'b', 'v1');

    expect(repo.setActiveVersion).toHaveBeenCalledWith('org', 'm', 'v1', 3);
    expect(realtime.pushToOrg).toHaveBeenCalledWith('org', 'v1:buildingModel:activated', { propertyId: 'b', versionId: 'v1' });
    expect(dto).not.toHaveProperty('storageKey');
  });

  it('activateVersion throws MODEL_004 when the version belongs to another model', async () => {
    repo.findByProperty.mockResolvedValue(model);
    repo.findVersion.mockResolvedValue({ id: 'v1', buildingModelId: 'OTHER', organizationId: 'org', storageKey: 'k' });
    await expect(service.activateVersion(owner, 'b', 'v1')).rejects.toMatchObject({ code: 'MODEL_004' });
  });

  it('activateVersion throws SYNC_001 on a version conflict', async () => {
    repo.findByProperty.mockResolvedValue(model);
    repo.findVersion.mockResolvedValue({ id: 'v1', buildingModelId: 'm', organizationId: 'org', storageKey: 'k' });
    repo.setActiveVersion.mockResolvedValue(false);
    await expect(service.activateVersion(owner, 'b', 'v1')).rejects.toMatchObject({ code: 'SYNC_001' });
  });

  it('deleting the active version is blocked with MODEL_005 (object untouched)', async () => {
    repo.findByProperty.mockResolvedValue(model);
    repo.findVersion.mockResolvedValue({ id: 'vACTIVE', buildingModelId: 'm', organizationId: 'org', storageKey: 'k' });
    await expect(service.deleteVersion(owner, 'b', 'vACTIVE')).rejects.toMatchObject({ code: 'MODEL_005' });
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(repo.deleteVersion).not.toHaveBeenCalled();
  });

  it('deleting a non-active version removes the row, the object, audits, and emits', async () => {
    repo.findByProperty.mockResolvedValue(model);
    const version = { id: 'v2', buildingModelId: 'm', organizationId: 'org', storageKey: 'k2' };
    repo.findVersion.mockResolvedValue(version);
    repo.deleteVersion.mockResolvedValue({ count: 1 });

    await service.deleteVersion(owner, 'b', 'v2');

    expect(repo.deleteVersion).toHaveBeenCalledWith('org', 'v2');
    expect(storage.deleteObject).toHaveBeenCalledWith('k2');
    expect(audit.recordDelete).toHaveBeenCalledWith('org', 'BuildingModelVersion', version);
    expect(realtime.pushToOrg).toHaveBeenCalledWith('org', 'v1:buildingModel:deleted', { versionId: 'v2' });
  });
});
