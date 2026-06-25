import { Test, TestingModule } from '@nestjs/testing';
import { ExportService } from '../export.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PropertiesService } from '../../properties/properties.service';
import { PermissionsService } from '../../permissions/permissions.service';

const owner = { id: 'm-owner', organizationId: 'org-1', role: 'OWNER' as const };
const admin = { id: 'm-admin', organizationId: 'org-1', role: 'ADMIN' as const };

const mockPrisma = {
  property: { findFirst: jest.fn() },
  device: { findMany: jest.fn() },
} as any;
const mockProperties = { subtreePropertyIds: jest.fn() } as any;
const mockPermissions = { inScope: jest.fn(), scopeFilter: jest.fn() } as any;

describe('ExportService', () => {
  let svc: ExportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PropertiesService, useValue: mockProperties },
        { provide: PermissionsService, useValue: mockPermissions },
      ],
    }).compile();
    svc = module.get(ExportService);
    jest.clearAllMocks();
    mockPermissions.scopeFilter.mockResolvedValue(null);
    mockPermissions.inScope.mockResolvedValue(true);
  });

  it('builds IFC from in-scope placed devices (OWNER → full subtree, no scope filter)', async () => {
    mockPrisma.property.findFirst.mockResolvedValue({ id: 'bld', name: 'HQ', type: 'BUILDING' });
    mockProperties.subtreePropertyIds.mockResolvedValue(['bld', 'floor']);
    mockPrisma.device.findMany.mockResolvedValue([
      {
        id: '11111111-1111-1111-1111-111111111111',
        x: 1,
        y: 2,
        z: 3,
      },
    ]);
    const { filename, ifc } = await svc.getBuildingExport(owner, 'bld');
    expect(filename).toBe('HQ-network.ifc');
    expect(ifc.match(/IFCBUILDINGELEMENTPROXY/g) ?? []).toHaveLength(1);
    expect(ifc).toContain('IFCCARTESIANPOINT((1.000000,2.000000,3.000000))');
    expect(mockPrisma.device.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          propertyId: { in: ['bld', 'floor'] },
          x: { not: null },
          y: { not: null },
          z: { not: null },
        }),
      }),
    );
  });

  // SECURITY REGRESSION: exported IFC must contain zero network-sensitive data
  it('SECURITY: exported IFC must not contain IP/MAC/network name/device name — only geometry + pointer', async () => {
    mockPrisma.property.findFirst.mockResolvedValue({ id: 'bld', name: 'HQ', type: 'BUILDING' });
    mockProperties.subtreePropertyIds.mockResolvedValue(['bld', 'floor']);
    const sensitiveDeviceId = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';
    mockPrisma.device.findMany.mockResolvedValue([
      {
        id: sensitiveDeviceId,
        x: 5,
        y: 6,
        z: 7,
      },
    ]);
    const { ifc } = await svc.getBuildingExport(owner, 'bld');
    // Pointer must survive for DB re-association
    expect(ifc).toContain('NodeScopeId');
    expect(ifc).toContain(sensitiveDeviceId);
    // Sensitive property labels must be absent
    expect(ifc).not.toContain('IPAddress');
    expect(ifc).not.toContain('MACAddress');
    expect(ifc).not.toMatch(/IFCPROPERTYSINGLEVALUE\('Network'/);
    expect(ifc).not.toContain("'Category'");
    // DB query must use select (not include network) — defense-in-depth
    expect(mockPrisma.device.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ id: true, x: true, y: true, z: true }),
      }),
    );
  });

  it('404s an unknown building (PROP_001)', async () => {
    mockPrisma.property.findFirst.mockResolvedValue(null);
    await expect(svc.getBuildingExport(owner, 'no-such')).rejects.toMatchObject({ code: 'PROP_001' });
  });

  it('404s an out-of-scope building for a non-OWNER (invisible-not-forbidden)', async () => {
    mockPrisma.property.findFirst.mockResolvedValue({ id: 'bld', name: 'HQ', type: 'BUILDING' });
    mockPermissions.inScope.mockResolvedValue(false);
    await expect(svc.getBuildingExport(admin, 'bld')).rejects.toMatchObject({ code: 'PROP_001' });
  });

  it('ADMIN export intersects the building subtree with the F3 scope', async () => {
    mockPrisma.property.findFirst.mockResolvedValue({ id: 'bld', name: 'HQ', type: 'BUILDING' });
    mockPermissions.inScope.mockResolvedValue(true);
    mockPermissions.scopeFilter.mockResolvedValue({ propertyIdIn: ['floor', 'elsewhere'] });
    mockProperties.subtreePropertyIds.mockResolvedValue(['bld', 'floor']);
    mockPrisma.device.findMany.mockResolvedValue([]);
    await svc.getBuildingExport(admin, 'bld');
    expect(mockPrisma.device.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ propertyId: { in: ['floor'] } }) }),
    );
  });
});
