import { Test } from '@nestjs/testing';
import { SpatialService } from '../spatial.service';
import { SpatialRepository } from '../spatial.repository';
import { BuildingModelsRepository } from '../../building-models/building-models.repository';
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
  } as unknown as jest.Mocked<SpatialRepository>;
  const models = {
    findByProperty: jest.fn(),
  } as unknown as jest.Mocked<BuildingModelsRepository>;

  beforeEach(async () => {
    jest.clearAllMocks();
    const ref = await Test.createTestingModule({
      providers: [
        SpatialService,
        { provide: SpatialRepository, useValue: repo },
        { provide: BuildingModelsRepository, useValue: models },
      ],
    }).compile();
    service = ref.get(SpatialService);
    // Default: device exists
    repo.findDevice.mockResolvedValue(fullDevice());
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
});
