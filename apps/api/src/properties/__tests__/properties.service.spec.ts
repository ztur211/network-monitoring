import { Test } from '@nestjs/testing';
import { PropertiesService } from '../properties.service';
import { PropertiesRepository } from '../properties.repository';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { AuditService } from '../../audit/audit.service';

const repoMock = () => ({
  create: jest.fn(), findByIdAndOrgId: jest.fn(), findAllByOrgId: jest.fn(),
  findChildren: jest.fn(), countChildren: jest.fn(), existsSiblingName: jest.fn(),
  updateWithVersion: jest.fn(), deleteByIdAndOrgId: jest.fn(),
  getSubtreeIds: jest.fn(), isAtOrUnder: jest.fn(),
});
const conflictMock = () => ({ emitEntityEvent: jest.fn(), buildUpdatePayload: jest.fn().mockReturnValue({}) });
const auditMock = () => ({ recordCreate: jest.fn(), recordUpdate: jest.fn(), recordDelete: jest.fn() });

describe('PropertiesService', () => {
  let service: PropertiesService;
  let repo: ReturnType<typeof repoMock>;

  beforeEach(async () => {
    repo = repoMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PropertiesService,
        { provide: PropertiesRepository, useValue: repo },
        { provide: ConflictResolutionService, useValue: conflictMock() },
        { provide: AuditService, useValue: auditMock() },
      ],
    }).compile();
    service = moduleRef.get(PropertiesService);
  });

  it('rejects a non-SITE root (PROP_002)', async () => {
    await expect(service.createProperty('o1', { type: 'BUILDING', name: 'X' } as any)).rejects.toMatchObject({ code: 'PROP_002' });
  });

  it('rejects an illegal child type (PROP_002)', async () => {
    repo.findByIdAndOrgId.mockResolvedValue({ id: 'p1', type: 'SITE', organizationId: 'o1' });
    repo.existsSiblingName.mockResolvedValue(false);
    await expect(service.createProperty('o1', { type: 'FLOOR', parentId: 'p1', name: 'X' } as any)).rejects.toMatchObject({ code: 'PROP_002' });
  });

  it('rejects a duplicate sibling name (PROP_003)', async () => {
    repo.findByIdAndOrgId.mockResolvedValue({ id: 'p1', type: 'SITE', organizationId: 'o1' });
    repo.existsSiblingName.mockResolvedValue(true);
    await expect(service.createProperty('o1', { type: 'BUILDING', parentId: 'p1', name: 'Dup' } as any)).rejects.toMatchObject({ code: 'PROP_003' });
  });

  it('blocks deleting a node with children (PROP_004)', async () => {
    repo.findByIdAndOrgId.mockResolvedValue({ id: 'p1', organizationId: 'o1' });
    repo.countChildren.mockResolvedValue(2);
    await expect(service.deleteProperty('o1', 'p1')).rejects.toMatchObject({ code: 'PROP_004' });
  });

  it('rejects a reparent that would create a cycle (PROP_005)', async () => {
    repo.findByIdAndOrgId
      .mockResolvedValueOnce({ id: 'p1', type: 'SITE', parentId: null, version: 1, organizationId: 'o1' }) // the node
      .mockResolvedValueOnce({ id: 'p2', type: 'SITE', organizationId: 'o1' });                            // the new parent
    repo.getSubtreeIds.mockResolvedValue(['p1', 'p2']); // p2 is under p1 → cycle
    await expect(service.updateProperty('o1', 'p1', { baseVersion: 1, changes: [{ field: 'parentId', oldValue: null, newValue: 'p2' }] } as any))
      .rejects.toMatchObject({ code: 'PROP_005' });
  });
});
