import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PropertyTreeRepository } from '../../property-tree/property-tree.repository';
import { NetworkPropertyRepository } from '../network-property.repository';
import { PropertiesRepository } from '../properties.repository';

describe('NetworkPropertyRepository (integration)', () => {
  let repo: NetworkPropertyRepository;
  let propsRepo: PropertiesRepository;
  let prisma: PrismaService;
  let orgId: string;
  let networkId: string;
  let siteId: string;
  let buildingId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [NetworkPropertyRepository, PropertiesRepository, PrismaService, PropertyTreeRepository],
    }).compile();
    repo = moduleRef.get(NetworkPropertyRepository);
    propsRepo = moduleRef.get(PropertiesRepository);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: `NPR${Date.now()}${Math.round(performance.now())}` } });
    orgId = org.id;
    const site = await propsRepo.create({ organizationId: orgId, parentId: null, type: 'SITE', name: 'HQ', code: 'hq' });
    siteId = site.id;
    const building = await propsRepo.create({ organizationId: orgId, parentId: siteId, type: 'BUILDING', name: 'Bldg A', code: null });
    buildingId = building.id;
    const net = await prisma.network.create({ data: { organizationId: orgId, name: 'Main Net', homeLatitude: 0, homeLongitude: 0 } });
    networkId = net.id;
  });

  afterEach(async () => { await prisma.organization.delete({ where: { id: orgId } }); });

  it('creates a charter and lists it by network', async () => {
    const charter = await repo.create(orgId, networkId, siteId);
    expect(charter.id).toBeDefined();
    expect(charter.networkId).toBe(networkId);
    expect(charter.propertyId).toBe(siteId);

    const list = await repo.listByNetwork(orgId, networkId);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(charter.id);
  });

  it('propertyIdsByNetwork returns only the chartered property ids', async () => {
    await repo.create(orgId, networkId, siteId);
    await repo.create(orgId, networkId, buildingId);
    const ids = await repo.propertyIdsByNetwork(orgId, networkId);
    expect(ids.sort()).toEqual([siteId, buildingId].sort());
  });

  it('existsCharter returns the charter when present, null when absent', async () => {
    expect(await repo.existsCharter(orgId, networkId, siteId)).toBeNull();
    const charter = await repo.create(orgId, networkId, siteId);
    const found = await repo.existsCharter(orgId, networkId, siteId);
    expect(found?.id).toBe(charter.id);
  });

  it('deleteByNetworkAndProperty removes the charter and returns count', async () => {
    await repo.create(orgId, networkId, siteId);
    const count = await repo.deleteByNetworkAndProperty(orgId, networkId, siteId);
    expect(count).toBe(1);
    expect(await repo.existsCharter(orgId, networkId, siteId)).toBeNull();
  });

  it('findByIdAndOrg returns null for a different org', async () => {
    const charter = await repo.create(orgId, networkId, siteId);
    const other = await prisma.organization.create({ data: { name: 'Other' } });
    expect(await repo.findByIdAndOrg(charter.id, other.id)).toBeNull();
    await prisma.organization.delete({ where: { id: other.id } });
  });

  // PropertiesRepository extension tests

  it('getAncestorIds returns self + ancestors for a nested property', async () => {
    const floor = await propsRepo.create({ organizationId: orgId, parentId: buildingId, type: 'FLOOR', name: 'F1', code: null });
    const ancestors = await propsRepo.getAncestorIds(orgId, floor.id);
    expect(ancestors.sort()).toEqual([floor.id, buildingId, siteId].sort());
  });

  it('getAncestorIds returns only self for a root property', async () => {
    const ancestors = await propsRepo.getAncestorIds(orgId, siteId);
    expect(ancestors).toEqual([siteId]);
  });

  it('countDevicesUnder returns the count of devices placed at the given properties', async () => {
    const floor = await propsRepo.create({ organizationId: orgId, parentId: buildingId, type: 'FLOOR', name: 'F2', code: null });
    // Subtree of siteId includes: siteId, buildingId, floor.id
    const subtree = await propsRepo.getSubtreeIds(orgId, siteId);

    // No devices yet
    expect(await propsRepo.countDevicesUnder(orgId, subtree)).toBe(0);

    // Place a device at floor
    await prisma.device.create({
      data: {
        organizationId: orgId,
        networkId,
        propertyId: floor.id,
        name: 'Dev1',
        category: 'ROUTER',
        latitude: 0,
        longitude: 0,
      },
    });

    expect(await propsRepo.countDevicesUnder(orgId, subtree)).toBe(1);
  });

  it('countChartersUnder returns the count of charters for the given property ids', async () => {
    const subtree = await propsRepo.getSubtreeIds(orgId, siteId);
    expect(await propsRepo.countChartersUnder(orgId, subtree)).toBe(0);

    await repo.create(orgId, networkId, siteId);
    expect(await propsRepo.countChartersUnder(orgId, subtree)).toBe(1);

    await repo.create(orgId, networkId, buildingId);
    expect(await propsRepo.countChartersUnder(orgId, subtree)).toBe(2);
  });
});
