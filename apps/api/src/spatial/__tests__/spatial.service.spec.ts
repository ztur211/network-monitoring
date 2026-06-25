import { Test } from '@nestjs/testing';
import { SpatialService } from '../spatial.service';
import { SpatialRepository } from '../spatial.repository';
import { BuildingModelsRepository } from '../../building-models/building-models.repository';
import { PermissionsService } from '../../permissions/permissions.service';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import type { OrgMemberContext } from '../../organizations/org-context.types';
import type { Device } from '@prisma/client';
import { DeviceCategory, DeviceMobility } from '@prisma/client';

// OrgMemberContext has: id, organizationId, role
const owner: OrgMemberContext = { id: 'm-1', organizationId: 'org', role: 'OWNER' };

// The mock result of repo.setPosition must be a complete Device (toDeviceDto calls
// createdAt.toISOString() and updatedAt.toISOString(), so they must be real Dates).
const fullDevice = (over: Partial<Device> = {}): Device => ({
  id: 'd',
  organizationId: 'org',
  networkId: 'n',
  propertyId: 'p',
  roleCode: null,
  userId: 'u',
  name: 'dev',
  category: DeviceCategory.ROUTER,
  mobility: DeviceMobility.UNKNOWN,
  ifcGlobalId: null,
  latitude: null,
  longitude: null,
  floor: null,
  floorLabel: null,
  x: null,
  y: null,
  z: null,
  ipAddress: null,
  macAddress: null,
  notes: null,
  version: 1,
  snmpCredentialId: null,
  oidProfileId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

describe('SpatialService.setPosition (unit)', () => {
  let service: SpatialService;
  const repo = {
    findDevice: jest.fn(),
    resolveGoverningBuildingId: jest.fn(),
    setPosition: jest.fn(),
    setIfcLink: jest.fn(),
  } as unknown as jest.Mocked<SpatialRepository>;
  const models = {
    findByProperty: jest.fn(),
  } as unknown as jest.Mocked<BuildingModelsRepository>;
  const permissions = { assertCanConfigure: jest.fn() } as any;
  const conflict = { emitScoped: jest.fn() } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const ref = await Test.createTestingModule({
      providers: [
        SpatialService,
        { provide: SpatialRepository, useValue: repo },
        { provide: BuildingModelsRepository, useValue: models },
        { provide: PermissionsService, useValue: permissions },
        { provide: ConflictResolutionService, useValue: conflict },
      ],
    }).compile();
    service = ref.get(SpatialService);
    // Default: device exists; configure allowed; emit resolves
    repo.findDevice.mockResolvedValue(fullDevice());
    permissions.assertCanConfigure.mockResolvedValue(undefined);
    conflict.emitScoped.mockResolvedValue(undefined);
  });

  it('rejects when device not found (DEVICE_001)', async () => {
    repo.findDevice.mockResolvedValue(null);
    await expect(
      service.setPosition(owner, 'd', { x: 1, y: 2, z: 3 }),
    ).rejects.toMatchObject({ code: 'DEVICE_001' });
  });

  it('rejects an incomplete triple with SPATIAL_002', async () => {
    await expect(
      service.setPosition(owner, 'd', { x: 1, y: 2, z: null }),
    ).rejects.toMatchObject({ code: 'SPATIAL_002' });
  });

  it('rejects a different partial shape (one set, two null) with SPATIAL_002', async () => {
    await expect(
      service.setPosition(owner, 'd', { x: 1, y: null, z: null }),
    ).rejects.toMatchObject({ code: 'SPATIAL_002' });
  });

  it('rejects when the device is not under a modeled building (SPATIAL_001)', async () => {
    repo.resolveGoverningBuildingId.mockResolvedValue('b1');
    models.findByProperty.mockResolvedValue(null); // building has no model
    await expect(
      service.setPosition(owner, 'd', { x: 1, y: 2, z: 3 }),
    ).rejects.toMatchObject({ code: 'SPATIAL_001' });
  });

  it('also SPATIAL_001 when there is no governing building at all', async () => {
    repo.resolveGoverningBuildingId.mockResolvedValue(null);
    await expect(
      service.setPosition(owner, 'd', { x: 1, y: 2, z: 3 }),
    ).rejects.toMatchObject({ code: 'SPATIAL_001' });
    expect(models.findByProperty).not.toHaveBeenCalled();
  });

  it('sets a complete triple when building+model resolve', async () => {
    repo.resolveGoverningBuildingId.mockResolvedValue('b1');
    models.findByProperty.mockResolvedValue({ id: 'm' } as any);
    repo.setPosition.mockResolvedValue(fullDevice({ x: 1, y: 2, z: 3 }));
    const dto = await service.setPosition(owner, 'd', { x: 1, y: 2, z: 3 });
    expect(repo.setPosition).toHaveBeenCalledWith('org', 'd', 1, 2, 3);
    expect(dto).toMatchObject({ id: 'd', x: 1, y: 2, z: 3 });
  });

  it('authorizes per-site scope (out-of-scope ADMIN → PERM_001)', async () => {
    permissions.assertCanConfigure.mockRejectedValue(Object.assign(new Error('x'), { code: 'PERM_001' }));
    await expect(
      service.setPosition({ id: 'm-admin', organizationId: 'org', role: 'ADMIN' }, 'd', { x: 1, y: 2, z: 3 }),
    ).rejects.toMatchObject({ code: 'PERM_001' });
    expect(permissions.assertCanConfigure).toHaveBeenCalledWith(
      { id: 'm-admin', organizationId: 'org', role: 'ADMIN' },
      'p', // the device's governing site (propertyId)
    );
    expect(repo.setPosition).not.toHaveBeenCalled();
  });

  it('emits v1:device:updated (with the device) on a successful set, scoped to the site', async () => {
    repo.resolveGoverningBuildingId.mockResolvedValue('b1');
    models.findByProperty.mockResolvedValue({ id: 'm' } as any);
    repo.setPosition.mockResolvedValue(fullDevice({ x: 1, y: 2, z: 3 }));
    await service.setPosition(owner, 'd', { x: 1, y: 2, z: 3 });
    expect(conflict.emitScoped).toHaveBeenCalledWith(
      'org',
      'p',
      'v1:device:updated',
      expect.objectContaining({ deviceId: 'd', device: expect.objectContaining({ id: 'd', x: 1, y: 2, z: 3 }) }),
    );
  });

  it('clearing (all null) is always allowed without a building check', async () => {
    repo.setPosition.mockResolvedValue(fullDevice({ x: null, y: null, z: null }));
    await service.setPosition(owner, 'd', { x: null, y: null, z: null });
    expect(repo.resolveGoverningBuildingId).not.toHaveBeenCalled();
  });

  it('throws DEVICE_001 if the device vanished between check and write (setPosition returns null)', async () => {
    repo.setPosition.mockResolvedValue(null);
    await expect(
      service.setPosition(owner, 'd', { x: null, y: null, z: null }),
    ).rejects.toMatchObject({ code: 'DEVICE_001' });
  });

  describe('setIfcLink', () => {
    it('rejects when device not found (DEVICE_001)', async () => {
      repo.findDevice.mockResolvedValue(null);
      await expect(service.setIfcLink(owner, 'd', '1aB$_guid')).rejects.toMatchObject({
        code: 'DEVICE_001',
      });
    });

    it('links the device to an element GUID when building+model resolve', async () => {
      repo.resolveGoverningBuildingId.mockResolvedValue('b1');
      models.findByProperty.mockResolvedValue({ id: 'm' } as any);
      repo.setIfcLink.mockResolvedValue(fullDevice({ ifcGlobalId: '1aB$_guid' }));
      const dto = await service.setIfcLink(owner, 'd', '1aB$_guid');
      expect(repo.setIfcLink).toHaveBeenCalledWith('org', 'd', '1aB$_guid');
      expect(dto).toMatchObject({ id: 'd', ifcGlobalId: '1aB$_guid' });
    });

    it('trims surrounding whitespace before persisting', async () => {
      repo.resolveGoverningBuildingId.mockResolvedValue('b1');
      models.findByProperty.mockResolvedValue({ id: 'm' } as any);
      repo.setIfcLink.mockResolvedValue(fullDevice({ ifcGlobalId: 'guid' }));
      await service.setIfcLink(owner, 'd', '  guid  ');
      expect(repo.setIfcLink).toHaveBeenCalledWith('org', 'd', 'guid');
    });

    it('rejects setting a link when the device is not under a modeled building (SPATIAL_001)', async () => {
      repo.resolveGoverningBuildingId.mockResolvedValue(null);
      await expect(service.setIfcLink(owner, 'd', 'guid')).rejects.toMatchObject({
        code: 'SPATIAL_001',
      });
      expect(repo.setIfcLink).not.toHaveBeenCalled();
    });

    it('clearing (null) is allowed without a building check', async () => {
      repo.setIfcLink.mockResolvedValue(fullDevice({ ifcGlobalId: null }));
      await service.setIfcLink(owner, 'd', null);
      expect(repo.resolveGoverningBuildingId).not.toHaveBeenCalled();
      expect(repo.setIfcLink).toHaveBeenCalledWith('org', 'd', null);
    });

    it('an empty/whitespace string normalizes to a clear (null), no building check', async () => {
      repo.setIfcLink.mockResolvedValue(fullDevice({ ifcGlobalId: null }));
      await service.setIfcLink(owner, 'd', '   ');
      expect(repo.resolveGoverningBuildingId).not.toHaveBeenCalled();
      expect(repo.setIfcLink).toHaveBeenCalledWith('org', 'd', null);
    });

    it('authorizes per-site scope (out-of-scope ADMIN → PERM_001, no write)', async () => {
      permissions.assertCanConfigure.mockRejectedValue(
        Object.assign(new Error('x'), { code: 'PERM_001' }),
      );
      await expect(
        service.setIfcLink({ id: 'm-admin', organizationId: 'org', role: 'ADMIN' }, 'd', 'guid'),
      ).rejects.toMatchObject({ code: 'PERM_001' });
      expect(permissions.assertCanConfigure).toHaveBeenCalledWith(
        { id: 'm-admin', organizationId: 'org', role: 'ADMIN' },
        'p',
      );
      expect(repo.setIfcLink).not.toHaveBeenCalled();
    });

    it('emits v1:device:updated (carrying the ifcGlobalId change) scoped to the site', async () => {
      repo.resolveGoverningBuildingId.mockResolvedValue('b1');
      models.findByProperty.mockResolvedValue({ id: 'm' } as any);
      repo.setIfcLink.mockResolvedValue(fullDevice({ ifcGlobalId: 'guid' }));
      await service.setIfcLink(owner, 'd', 'guid');
      expect(conflict.emitScoped).toHaveBeenCalledWith(
        'org',
        'p',
        'v1:device:updated',
        expect.objectContaining({
          deviceId: 'd',
          device: expect.objectContaining({ id: 'd', ifcGlobalId: 'guid' }),
          changes: [{ field: 'ifcGlobalId', oldValue: null, newValue: 'guid' }],
        }),
      );
    });
  });
});
