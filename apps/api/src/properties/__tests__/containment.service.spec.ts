import { Test } from '@nestjs/testing';
import { ContainmentService } from '../containment.service';
import { PropertiesRepository } from '../properties.repository';
import { NetworkPropertyRepository } from '../network-property.repository';

const propsMock = () => ({
  getAncestorIds: jest.fn(),
  getSubtreeIds: jest.fn(),
  devicesUnder: jest.fn(),
});
const charterMock = () => ({ propertyIdsByNetwork: jest.fn() });

describe('ContainmentService', () => {
  let svc: ContainmentService;
  let props: ReturnType<typeof propsMock>;
  let charters: ReturnType<typeof charterMock>;

  beforeEach(async () => {
    props = propsMock();
    charters = charterMock();
    const m = await Test.createTestingModule({
      providers: [
        ContainmentService,
        { provide: PropertiesRepository, useValue: props },
        { provide: NetworkPropertyRepository, useValue: charters },
      ],
    }).compile();
    svc = m.get(ContainmentService);
  });

  // assertDevicePlacement

  it('allows placement at/under a chartered site', async () => {
    props.getAncestorIds.mockResolvedValue(['floor1', 'bldgA', 'siteHQ']);
    charters.propertyIdsByNetwork.mockResolvedValue(['siteHQ']);
    await expect(svc.assertDevicePlacement('o1', 'net1', 'floor1')).resolves.toBeUndefined();
  });

  it('rejects placement outside every charter (PROP_007)', async () => {
    props.getAncestorIds.mockResolvedValue(['floor1', 'bldgA', 'siteHQ']);
    charters.propertyIdsByNetwork.mockResolvedValue(['siteOther']);
    await expect(svc.assertDevicePlacement('o1', 'net1', 'floor1')).rejects.toMatchObject({ code: 'PROP_007' });
  });

  it('rejects placement when network has no charters (PROP_007)', async () => {
    props.getAncestorIds.mockResolvedValue(['floor1', 'bldgA', 'siteHQ']);
    charters.propertyIdsByNetwork.mockResolvedValue([]);
    await expect(svc.assertDevicePlacement('o1', 'net1', 'floor1')).rejects.toMatchObject({ code: 'PROP_007' });
  });

  // assertReparentKeepsContainment

  it('passes when moved subtree has no devices', async () => {
    props.getSubtreeIds.mockResolvedValue(['bldgA', 'floor1']);
    props.devicesUnder.mockResolvedValue([]);
    await expect(svc.assertReparentKeepsContainment('o1', 'bldgA', 'newSite')).resolves.toBeUndefined();
    expect(props.getAncestorIds).not.toHaveBeenCalled();
  });

  it('passes when device remains covered under new parent', async () => {
    // Subtree of movedId ('bldg') contains floor1 and bldg
    props.getSubtreeIds.mockResolvedValue(['bldg', 'floor1']);
    // One device at floor1 on net1
    props.devicesUnder.mockResolvedValue([{ id: 'd1', networkId: 'net1', propertyId: 'floor1' }]);
    // Ancestors of floor1 (device's property): floor1 → bldg → (site removed but bldg is the moved root)
    props.getAncestorIds.mockImplementation((_orgId: string, propId: string) => {
      if (propId === 'floor1') return Promise.resolve(['floor1', 'bldg']);
      if (propId === 'newSite') return Promise.resolve(['newSite']); // new parent's ancestors
      return Promise.resolve([propId]);
    });
    // net1's charter is at newSite
    charters.propertyIdsByNetwork.mockResolvedValue(['newSite']);
    await expect(svc.assertReparentKeepsContainment('o1', 'bldg', 'newSite')).resolves.toBeUndefined();
  });

  it('throws PROP_007 when reparent would orphan a placed device', async () => {
    props.getSubtreeIds.mockResolvedValue(['bldg', 'floor1']);
    props.devicesUnder.mockResolvedValue([{ id: 'd1', networkId: 'net1', propertyId: 'floor1' }]);
    props.getAncestorIds.mockImplementation((_orgId: string, propId: string) => {
      if (propId === 'floor1') return Promise.resolve(['floor1', 'bldg', 'oldSite']);
      if (propId === 'unrelatedSite') return Promise.resolve(['unrelatedSite']);
      return Promise.resolve([propId]);
    });
    // net1's charter is at oldSite — but after move to unrelatedSite, post ancestors won't include oldSite
    charters.propertyIdsByNetwork.mockResolvedValue(['oldSite']);
    await expect(svc.assertReparentKeepsContainment('o1', 'bldg', 'unrelatedSite')).rejects.toMatchObject({ code: 'PROP_007' });
  });

  it('passes when newParentId is null (making the subtree a new root)', async () => {
    props.getSubtreeIds.mockResolvedValue(['site1', 'bldg1']);
    // No devices — nothing to validate
    props.devicesUnder.mockResolvedValue([]);
    await expect(svc.assertReparentKeepsContainment('o1', 'site1', null)).resolves.toBeUndefined();
  });

  // assertCharterRemovable

  it('passes when no devices are in the removed charter subtree for that network', async () => {
    props.getSubtreeIds.mockResolvedValue(['site1', 'bldg1', 'floor1']);
    // devicesUnder returns a device on a DIFFERENT network — filtered out
    props.devicesUnder.mockResolvedValue([{ id: 'd1', networkId: 'otherNet', propertyId: 'floor1' }]);
    charters.propertyIdsByNetwork.mockResolvedValue(['site1']);
    await expect(svc.assertCharterRemovable('o1', 'net1', 'site1')).resolves.toBeUndefined();
  });

  it('throws PROP_008 when a device in the removed charter subtree is only covered by that charter', async () => {
    props.getSubtreeIds.mockResolvedValue(['site1', 'bldg1', 'floor1']);
    props.devicesUnder.mockResolvedValue([{ id: 'd1', networkId: 'net1', propertyId: 'floor1' }]);
    // No remaining charters after removing site1
    charters.propertyIdsByNetwork.mockResolvedValue(['site1']);
    props.getAncestorIds.mockResolvedValue(['floor1', 'bldg1', 'site1']);
    await expect(svc.assertCharterRemovable('o1', 'net1', 'site1')).rejects.toMatchObject({ code: 'PROP_008' });
  });

  it('passes when another charter still covers the device after removal', async () => {
    props.getSubtreeIds.mockResolvedValue(['site1', 'bldg1', 'floor1']);
    props.devicesUnder.mockResolvedValue([{ id: 'd1', networkId: 'net1', propertyId: 'floor1' }]);
    // Two charters: site1 (being removed) + site2 (remains)
    charters.propertyIdsByNetwork.mockResolvedValue(['site1', 'site2']);
    // floor1's ancestors include site2 — so the device stays covered
    props.getAncestorIds.mockResolvedValue(['floor1', 'bldg1', 'site1', 'site2']);
    await expect(svc.assertCharterRemovable('o1', 'net1', 'site1')).resolves.toBeUndefined();
  });
});
