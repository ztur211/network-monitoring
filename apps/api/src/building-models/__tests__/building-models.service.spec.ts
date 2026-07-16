import { Test } from '@nestjs/testing';
import { BuildingModelsService } from '../building-models.service';
import { BuildingModelsRepository } from '../building-models.repository';
import { StorageService } from '../../storage/storage.service';
import { PropertiesService } from '../../properties/properties.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { AuditService } from '../../audit/audit.service';
import { REALTIME_SERVICE } from '../../realtime/realtime.types';
import type { OrgMemberContext } from '../../organizations/org-context.types';
import { PassThrough, Readable } from 'node:stream';

const owner = { id: 'mem-o', organizationId: 'org', role: 'OWNER' } as OrgMemberContext;
const admin = { id: 'mem-a', organizationId: 'org', role: 'ADMIN' } as OrgMemberContext;
const model = { id: 'm', organizationId: 'org', propertyId: 'b', name: 'B', activeVersionId: 'vACTIVE', version: 3, createdAt: new Date(), updatedAt: new Date() };

describe('BuildingModelsService (unit)', () => {
  let service: BuildingModelsService;
  const repo = {
    findByProperty: jest.fn(), findVersion: jest.fn(), setActiveVersion: jest.fn(),
    deleteVersion: jest.fn(), listVersions: jest.fn(), createModel: jest.fn(),
    nextVersionNumber: jest.fn(), createVersion: jest.fn(),
  } as any;
  const storage = {
    deleteObject: jest.fn().mockResolvedValue(undefined),
    putObjectStream: jest.fn(), buildVersionKey: jest.fn(() => 'model-key'),
  } as any;
  const properties = { findInOrg: jest.fn() } as any;
  const audit = { recordCreate: jest.fn(), recordDelete: jest.fn(), recordUpdate: jest.fn() } as any;
  const realtime = { pushToOrg: jest.fn() } as any;
  // assertCanConfigure mirrors the real one: OWNER resolves; otherwise it's stubbed per-test.
  const permissions = {
    assertCanConfigure: jest.fn().mockResolvedValue(undefined),
    inScope: jest.fn().mockResolvedValue(true),
  } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    permissions.assertCanConfigure.mockResolvedValue(undefined);
    permissions.inScope.mockResolvedValue(true);
    const ref = await Test.createTestingModule({
      providers: [
        BuildingModelsService,
        { provide: BuildingModelsRepository, useValue: repo },
        { provide: StorageService, useValue: storage },
        { provide: PropertiesService, useValue: properties },
        { provide: PermissionsService, useValue: permissions },
        { provide: AuditService, useValue: audit },
        { provide: REALTIME_SERVICE, useValue: realtime },
      ],
    }).compile();
    service = ref.get(BuildingModelsService);
  });

  describe('F3 scope enforcement', () => {
    it('activateVersion is gated by assertCanConfigure (out-of-scope ADMIN → PERM_001, no write)', async () => {
      permissions.assertCanConfigure.mockRejectedValue(
        Object.assign(new Error('x'), { code: 'PERM_001' }),
      );
      await expect(service.activateVersion(admin, 'b', 'v1')).rejects.toMatchObject({ code: 'PERM_001' });
      expect(permissions.assertCanConfigure).toHaveBeenCalledWith(admin, 'b');
      expect(repo.setActiveVersion).not.toHaveBeenCalled();
      expect(repo.findByProperty).not.toHaveBeenCalled(); // gated before any load
    });

    it('deleteVersion is gated by assertCanConfigure', async () => {
      permissions.assertCanConfigure.mockRejectedValue(
        Object.assign(new Error('x'), { code: 'PERM_001' }),
      );
      await expect(service.deleteVersion(admin, 'b', 'v2')).rejects.toMatchObject({ code: 'PERM_001' });
      expect(repo.deleteVersion).not.toHaveBeenCalled();
    });

    it('reads 404 for an out-of-scope, non-OWNER member (existence not revealed)', async () => {
      permissions.inScope.mockResolvedValue(false);
      await expect(service.getModel(admin, 'b')).rejects.toMatchObject({ code: 'MODEL_001' });
      await expect(service.getActiveFile(admin, 'b')).rejects.toMatchObject({ code: 'MODEL_001' });
      expect(repo.findByProperty).not.toHaveBeenCalled(); // gated before the model load
    });

    it('an in-scope ADMIN can read (OWNER-bypass not required)', async () => {
      permissions.inScope.mockResolvedValue(true);
      repo.findByProperty.mockResolvedValue(model);
      await expect(service.getModel(admin, 'b')).resolves.toMatchObject({ propertyId: 'b' });
    });
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
    expect(storage.deleteObject.mock.invocationCallOrder[0]).toBeLessThan(
      repo.deleteVersion.mock.invocationCallOrder[0],
    );
  });

  it('destroys the upload pipeline and deletes partial storage when the request aborts', async () => {
    properties.findInOrg.mockResolvedValue({ id: 'b', type: 'BUILDING', name: 'B' });
    storage.putObjectStream.mockImplementation(async (_key: string, stream: Readable) => {
      for await (const _chunk of stream) { /* drain */ }
    });
    const body = new PassThrough();
    body.on('error', () => undefined);

    const pending = service.uploadVersion(owner, 'b', 'x.ifc', null, body);
    const expectation = expect(pending).rejects.toThrow('client aborted');
    while (storage.putObjectStream.mock.calls.length === 0) await new Promise(setImmediate);
    body.destroy(new Error('client aborted'));

    await expectation;
    expect(storage.deleteObject).toHaveBeenCalledWith('model-key');
  });

  it('deletes a landed object when persistence fails before a version row exists', async () => {
    properties.findInOrg.mockResolvedValue({ id: 'b', type: 'BUILDING', name: 'B' });
    storage.putObjectStream.mockImplementation(async (_key: string, stream: Readable) => {
      for await (const _chunk of stream) { /* drain */ }
    });
    repo.findByProperty.mockRejectedValue(new Error('database down'));
    const body = Readable.from(Buffer.from('ISO-10303-21;\nEND-ISO-10303-21;'));

    await expect(service.uploadVersion(owner, 'b', 'x.ifc', null, body)).rejects.toThrow('database down');
    expect(storage.deleteObject).toHaveBeenCalledWith('model-key');
  });
});
