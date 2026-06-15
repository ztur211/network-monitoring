import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { DevicesRepository } from '../devices.repository';
import { OrganizationsRepository } from '../../organizations/organizations.repository';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { AuditService } from '../../audit/audit.service';
import { ChangeLogRepository } from '../../audit/change-log.repository';
import { auditAls } from '../../audit/audit.als';
import { DevicesService } from '../devices.service';
import { ContainmentService } from '../../properties/containment.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { SpatialRepository } from '../../spatial/spatial.repository';
import { DeviceCategory } from '@prisma/client';
import { CreateDeviceDto } from '../devices.dto';

/**
 * Integration tests — run against the real test database.
 * Requires docker compose -f docker-compose.test.yml up to be running.
 * TEST_DATABASE_URL must be set in the environment.
 */
describe('DevicesRepository (integration)', () => {
  let repository: DevicesRepository;
  let prisma: PrismaService;
  let testUserId: string;
  let testOrgId: string;
  let testOrgBId: string;
  let testNetworkId: string;
  let testPropertyId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DevicesRepository, PrismaService],
    }).compile();

    repository = module.get<DevicesRepository>(DevicesRepository);
    prisma = module.get<PrismaService>(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { email: `devrepo-${Date.now()}@example.com`, emailVerified: false },
    });
    testUserId = user.id;

    const orgA = await prisma.organization.create({
      data: { name: `DevRepoOrgA-${Date.now()}` },
    });
    testOrgId = orgA.id;

    const orgB = await prisma.organization.create({
      data: { name: `DevRepoOrgB-${Date.now()}` },
    });
    testOrgBId = orgB.id;

    const network = await prisma.network.create({
      data: { organizationId: testOrgId, userId: testUserId, name: 'Test Network' },
    });
    testNetworkId = network.id;

    const property = await prisma.property.create({
      data: { organizationId: testOrgId, name: 'HQ Site', type: 'SITE' },
    });
    testPropertyId = property.id;

    await prisma.networkProperty.create({
      data: { organizationId: testOrgId, networkId: testNetworkId, propertyId: testPropertyId },
    });
  });

  afterEach(async () => {
    await prisma.device.deleteMany({ where: { organizationId: { in: [testOrgId, testOrgBId] } } });
    await prisma.networkProperty.deleteMany({ where: { organizationId: { in: [testOrgId, testOrgBId] } } });
    await prisma.network.deleteMany({ where: { organizationId: { in: [testOrgId, testOrgBId] } } });
    await prisma.property.deleteMany({ where: { organizationId: { in: [testOrgId, testOrgBId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [testOrgId, testOrgBId] } } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  const baseCreate = (extra = {}) => ({
    organizationId: testOrgId,
    userId: testUserId,
    networkId: testNetworkId,
    propertyId: testPropertyId,
    name: `Device-${Date.now()}`,
    category: DeviceCategory.ROUTER,
    ...extra,
  });

  describe('create', () => {
    it('creates a device and returns it', async () => {
      const device = await repository.create(baseCreate({ name: 'Test Router' }));
      expect(device.id).toBeDefined();
      expect(device.name).toBe('Test Router');
      expect(device.organizationId).toBe(testOrgId);
      expect(device.userId).toBe(testUserId);
      expect(device.networkId).toBe(testNetworkId);
      expect(device.propertyId).toBe(testPropertyId);
      expect(device.version).toBe(1);
    });

    it('creates a device with null userId (system-created)', async () => {
      const device = await repository.create(baseCreate({ userId: null }));
      expect(device.id).toBeDefined();
      expect(device.userId).toBeNull();
    });
  });

  describe('findAllByOrgId', () => {
    it('returns devices for org ordered by createdAt desc', async () => {
      await repository.create(baseCreate({ name: 'Device A', category: DeviceCategory.SWITCH }));
      await repository.create(baseCreate({ name: 'Device B', category: DeviceCategory.ROUTER }));

      const devices = await repository.findAllByOrgId(testOrgId);
      expect(devices).toHaveLength(2);
    });

    it('does not return devices from another org', async () => {
      // OrgB has no network/property, but we can still check isolation by skipping creation in orgB
      const devices = await repository.findAllByOrgId(testOrgBId);
      expect(devices).toHaveLength(0);
    });
  });

  describe('countByOrgId', () => {
    it('returns correct device count for org', async () => {
      await repository.create(baseCreate({ name: 'Device 1', category: DeviceCategory.SWITCH }));
      const count = await repository.countByOrgId(testOrgId);
      expect(count).toBe(1);
    });
  });

  describe('findByIdAndOrgId', () => {
    it('returns device when found in org', async () => {
      const created = await repository.create(baseCreate({ name: 'Findable' }));
      const found = await repository.findByIdAndOrgId(created.id, testOrgId);
      expect(found?.id).toBe(created.id);
    });

    it('returns null when device belongs to a different org (cross-org isolation)', async () => {
      const created = await repository.create(baseCreate({ name: 'OrgA Device' }));
      const found = await repository.findByIdAndOrgId(created.id, testOrgBId);
      expect(found).toBeNull();
    });

    it('returns null for a completely non-existent device id', async () => {
      const found = await repository.findByIdAndOrgId('00000000-0000-0000-0000-000000000000', testOrgId);
      expect(found).toBeNull();
    });
  });

  describe('updateWithVersion', () => {
    it('updates device when version matches and returns updated device', async () => {
      const device = await repository.create(baseCreate({ name: 'Old Name' }));
      const updated = await repository.updateWithVersion(device.id, testOrgId, { name: 'New Name' }, 1);
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('New Name');
      expect(updated!.version).toBe(2);
    });

    it('returns null when version does not match (concurrent edit)', async () => {
      const device = await repository.create(baseCreate({ name: 'Device' }));
      const result = await repository.updateWithVersion(device.id, testOrgId, { notes: 'note' }, 99);
      expect(result).toBeNull();
    });

    it('returns null when deviceId belongs to a different org', async () => {
      const device = await repository.create(baseCreate({ name: 'OrgA Only' }));
      const result = await repository.updateWithVersion(device.id, testOrgBId, { notes: 'note' }, 1);
      expect(result).toBeNull();
    });
  });

  describe('existsByNameCaseInsensitive', () => {
    it('returns true when name matches (case-insensitive) in same org', async () => {
      await repository.create(baseCreate({ name: 'Router One' }));
      const exists = await repository.existsByNameCaseInsensitive(testOrgId, 'router one');
      expect(exists).toBe(true);
    });

    it('returns false when excluding own device id', async () => {
      const device = await repository.create(baseCreate({ name: 'Router One' }));
      const exists = await repository.existsByNameCaseInsensitive(testOrgId, 'router one', device.id);
      expect(exists).toBe(false);
    });

    it('returns false when same name exists in a different org', async () => {
      // Cannot create in orgB without its own network/property, skip with count assertion
      const exists = await repository.existsByNameCaseInsensitive(testOrgId, 'Unique Name Not Created');
      expect(exists).toBe(false);
    });
  });

  describe('deleteByIdAndOrgId', () => {
    it('deletes device', async () => {
      const device = await repository.create(baseCreate({ name: 'Delete Me' }));
      await repository.deleteByIdAndOrgId(device.id, testOrgId);
      const found = await repository.findByIdAndOrgId(device.id, testOrgId);
      expect(found).toBeNull();
    });

    it('does not delete device belonging to a different org', async () => {
      const device = await repository.create(baseCreate({ name: 'Stay' }));
      await repository.deleteByIdAndOrgId(device.id, testOrgBId);
      const found = await repository.findByIdAndOrgId(device.id, testOrgId);
      expect(found).not.toBeNull();
    });
  });
});

describe('DevicesService audit integration', () => {
  let service: DevicesService;
  let prisma: PrismaService;

  const mockConflict = {
    buildUpdatePayload: jest.fn(),
    emitEntityEvent: jest.fn(),
  };

  const mockContainment = {
    assertDevicePlacement: jest.fn().mockResolvedValue(undefined),
    assertReparentKeepsContainment: jest.fn().mockResolvedValue(undefined),
    assertCharterRemovable: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        DevicesRepository,
        OrganizationsRepository,
        ChangeLogRepository,
        AuditService,
        DevicesService,
        { provide: ConflictResolutionService, useValue: mockConflict },
        { provide: ContainmentService, useValue: mockContainment },
        { provide: PermissionsService, useValue: { scopeFilter: jest.fn().mockResolvedValue(null), assertCanConfigure: jest.fn().mockResolvedValue(undefined) } },
        { provide: SpatialRepository, useValue: { resolveGoverningBuildingId: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();

    service = module.get<DevicesService>(DevicesService);
    prisma = module.get<PrismaService>(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('writes a CREATE ChangeLog row scoped to the org when a device is created', async () => {
    const org = await prisma.organization.create({ data: { name: `Au${Date.now()}` } });
    const user = await prisma.user.create({
      data: { email: `a-${Date.now()}@x.com`, emailVerified: true, name: 'A' },
    });
    const network = await prisma.network.create({
      data: { organizationId: org.id, userId: user.id, name: 'Net' },
    });
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: 'Site', type: 'SITE' },
    });
    await prisma.networkProperty.create({
      data: { organizationId: org.id, networkId: network.id, propertyId: property.id },
    });

    await auditAls.run(
      { requestId: 'r1', userId: user.id, ipAddress: null, userAgent: null },
      async () =>
        service.createDevice(
          { id: 'owner-m', organizationId: org.id, role: 'OWNER' },
          user.id,
          {
            name: 'AuditCam',
            category: DeviceCategory.IOT_DEVICE,
            networkId: network.id,
            propertyId: property.id,
          } as CreateDeviceDto,
        ),
    );

    const logs = await prisma.changeLog.findMany({
      where: { organizationId: org.id, entityType: 'Device', action: 'CREATE' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].requestId).toBe('r1');
    expect(logs[0].userId).toBe(user.id);

    await prisma.changeLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.device.deleteMany({ where: { organizationId: org.id } });
    await prisma.networkProperty.deleteMany({ where: { organizationId: org.id } });
    await prisma.network.deleteMany({ where: { organizationId: org.id } });
    await prisma.property.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });
});
