import { Test } from '@nestjs/testing';
import { PropertiesService } from '../properties.service';
import { PropertiesRepository } from '../properties.repository';
import { ContainmentService } from '../containment.service';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { AuditService } from '../../audit/audit.service';
import { PermissionsService } from '../../permissions/permissions.service';
import type { OrgMemberContext } from '../../organizations/org-context.types';

const repoMock = () => ({
  create: jest.fn(), findByIdAndOrgId: jest.fn(), findAllByOrgId: jest.fn(),
  findChildren: jest.fn(), countChildren: jest.fn(), existsSiblingName: jest.fn(),
  updateWithVersion: jest.fn(), deleteByIdAndOrgId: jest.fn(),
  getSubtreeIds: jest.fn(), isAtOrUnder: jest.fn(),
  countDevicesUnder: jest.fn(), countChartersUnder: jest.fn(),
  countAssignmentsUnder: jest.fn(),
});
const conflictMock = () => ({ emitEntityEvent: jest.fn(), buildUpdatePayload: jest.fn().mockReturnValue({}) });
const auditMock = () => ({ recordCreate: jest.fn(), recordUpdate: jest.fn(), recordDelete: jest.fn() });
const containmentMock = () => ({
  assertDevicePlacement: jest.fn(),
  assertReparentKeepsContainment: jest.fn(),
  assertCharterRemovable: jest.fn(),
});
const permissionsMock = () => ({
  scopeFilter: jest.fn().mockResolvedValue(null),
  assertCanConfigure: jest.fn().mockResolvedValue(undefined),
});

const ownerMember: OrgMemberContext = { id: 'u1', organizationId: 'o1', role: 'OWNER' as const };

describe('PropertiesService', () => {
  let service: PropertiesService;
  let repo: ReturnType<typeof repoMock>;
  let containment: ReturnType<typeof containmentMock>;

  beforeEach(async () => {
    repo = repoMock();
    containment = containmentMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PropertiesService,
        { provide: PropertiesRepository, useValue: repo },
        { provide: ConflictResolutionService, useValue: conflictMock() },
        { provide: AuditService, useValue: auditMock() },
        { provide: ContainmentService, useValue: containment },
        { provide: PermissionsService, useValue: permissionsMock() },
      ],
    }).compile();
    service = moduleRef.get(PropertiesService);
  });

  it('rejects a non-SITE root (PROP_002)', async () => {
    await expect(service.createProperty(ownerMember, { type: 'BUILDING', name: 'X' } as any)).rejects.toMatchObject({ code: 'PROP_002' });
  });

  it('rejects an illegal child type (PROP_002)', async () => {
    repo.findByIdAndOrgId.mockResolvedValue({ id: 'p1', type: 'SITE', organizationId: 'o1' });
    repo.existsSiblingName.mockResolvedValue(false);
    await expect(service.createProperty(ownerMember, { type: 'FLOOR', parentId: 'p1', name: 'X' } as any)).rejects.toMatchObject({ code: 'PROP_002' });
  });

  it('rejects a duplicate sibling name (PROP_003)', async () => {
    repo.findByIdAndOrgId.mockResolvedValue({ id: 'p1', type: 'SITE', organizationId: 'o1' });
    repo.existsSiblingName.mockResolvedValue(true);
    await expect(service.createProperty(ownerMember, { type: 'BUILDING', parentId: 'p1', name: 'Dup' } as any)).rejects.toMatchObject({ code: 'PROP_003' });
  });

  it('blocks deleting a node with children (PROP_004)', async () => {
    repo.findByIdAndOrgId.mockResolvedValue({ id: 'p1', organizationId: 'o1' });
    // subtree has 2 entries (the node + 1 child)
    repo.getSubtreeIds.mockResolvedValue(['p1', 'child1']);
    repo.countDevicesUnder.mockResolvedValue(0);
    repo.countChartersUnder.mockResolvedValue(0);
    await expect(service.deleteProperty(ownerMember, 'p1')).rejects.toMatchObject({ code: 'PROP_004' });
  });

  it('blocks deleting a node with placed devices (PROP_004)', async () => {
    repo.findByIdAndOrgId.mockResolvedValue({ id: 'p1', organizationId: 'o1' });
    repo.getSubtreeIds.mockResolvedValue(['p1']); // leaf node, no children
    repo.countDevicesUnder.mockResolvedValue(1);
    repo.countChartersUnder.mockResolvedValue(0);
    await expect(service.deleteProperty(ownerMember, 'p1')).rejects.toMatchObject({ code: 'PROP_004' });
  });

  it('blocks deleting a node that is chartered by a network (PROP_004)', async () => {
    repo.findByIdAndOrgId.mockResolvedValue({ id: 'p1', organizationId: 'o1' });
    repo.getSubtreeIds.mockResolvedValue(['p1']); // leaf node, no children
    repo.countDevicesUnder.mockResolvedValue(0);
    repo.countChartersUnder.mockResolvedValue(1);
    await expect(service.deleteProperty(ownerMember, 'p1')).rejects.toMatchObject({ code: 'PROP_004' });
  });

  it('blocks deleting a node with team/member assignments (PERM_005)', async () => {
    repo.findByIdAndOrgId.mockResolvedValue({ id: 'p1', organizationId: 'o1' });
    repo.getSubtreeIds.mockResolvedValue(['p1']); // leaf node, no children
    repo.countDevicesUnder.mockResolvedValue(0);
    repo.countChartersUnder.mockResolvedValue(0);
    repo.countAssignmentsUnder.mockResolvedValue(1);
    await expect(service.deleteProperty(ownerMember, 'p1')).rejects.toMatchObject({ code: 'PERM_005' });
  });

  it('allows deleting a leaf node with no devices, charters, or assignments', async () => {
    repo.findByIdAndOrgId.mockResolvedValue({ id: 'p1', organizationId: 'o1' });
    repo.getSubtreeIds.mockResolvedValue(['p1']); // only self
    repo.countDevicesUnder.mockResolvedValue(0);
    repo.countChartersUnder.mockResolvedValue(0);
    repo.countAssignmentsUnder.mockResolvedValue(0);
    repo.deleteByIdAndOrgId.mockResolvedValue(undefined);
    await expect(service.deleteProperty(ownerMember, 'p1')).resolves.toBeUndefined();
  });

  it('rejects a reparent that would create a cycle (PROP_005)', async () => {
    repo.findByIdAndOrgId
      .mockResolvedValueOnce({ id: 'p1', type: 'SITE', parentId: null, version: 1, organizationId: 'o1' }) // the node
      .mockResolvedValueOnce({ id: 'p2', type: 'SITE', organizationId: 'o1' });                            // the new parent
    repo.getSubtreeIds.mockResolvedValue(['p1', 'p2']); // p2 is under p1 → cycle
    await expect(service.updateProperty(ownerMember, 'p1', { baseVersion: 1, changes: [{ field: 'parentId', oldValue: null, newValue: 'p2' }] } as any))
      .rejects.toMatchObject({ code: 'PROP_005' });
  });

  it('throws PROP_007 when reparent would orphan a device (from ContainmentService)', async () => {
    repo.findByIdAndOrgId
      .mockResolvedValueOnce({ id: 'p1', type: 'BUILDING', parentId: 'oldSite', version: 1, organizationId: 'o1' })
      .mockResolvedValueOnce({ id: 'newSite', type: 'SITE', organizationId: 'o1' }); // new parent
    repo.getSubtreeIds.mockResolvedValue(['p1']);
    repo.existsSiblingName.mockResolvedValue(false);
    const err = Object.assign(new Error(), { code: 'PROP_007' });
    containment.assertReparentKeepsContainment.mockRejectedValue(err);
    await expect(service.updateProperty(ownerMember, 'p1', {
      baseVersion: 1,
      changes: [{ field: 'parentId', oldValue: 'oldSite', newValue: 'newSite' }],
    } as any)).rejects.toMatchObject({ code: 'PROP_007' });
    expect(containment.assertReparentKeepsContainment).toHaveBeenCalledWith('o1', 'p1', 'newSite');
  });

  it('listProperties calls repo with scope from permissions', async () => {
    repo.findAllByOrgId.mockResolvedValue([]);
    await service.listProperties(ownerMember);
    // OWNER => scopeFilter returns null, repo gets null scope
    expect(repo.findAllByOrgId).toHaveBeenCalledWith('o1', null);
  });

  it('getProperty calls repo with scope from permissions', async () => {
    repo.findByIdAndOrgId.mockResolvedValue({ id: 'p1', organizationId: 'o1', parentId: null, type: 'SITE', name: 'S', code: null, version: 1, createdAt: new Date(), updatedAt: new Date() });
    await service.getProperty(ownerMember, 'p1');
    // First call is the scoped read
    expect(repo.findByIdAndOrgId).toHaveBeenCalledWith('p1', 'o1', null);
  });
});
