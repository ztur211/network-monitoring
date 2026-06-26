import { Test } from '@nestjs/testing';
import { OrganizationsService } from '../organizations.service';
import { OrganizationsRepository } from '../organizations.repository';
import { UsersRepository } from '../../users/users.repository';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

const repoMock = () => ({
  createOrganization: jest.fn(),
  findOrganizationById: jest.fn(),
  addDomain: jest.fn(),
  findOrganizationByDomain: jest.fn(),
  createMember: jest.fn(),
  findMemberByUserId: jest.fn(),
  findMembersByOrganizationId: jest.fn(),
  updateOrganizationWithVersion: jest.fn(),
  findMemberByUserAndOrg: jest.fn(),
  updateMemberRole: jest.fn(),
  deleteMember: jest.fn(),
  countOwners: jest.fn(),
});
const usersMock = () => ({ findByEmail: jest.fn() });
const conflictMock = () => ({
  buildUpdatePayload: jest.fn(),
  emitEntityEvent: jest.fn(),
  evictOrgMember: jest.fn().mockResolvedValue(undefined),
});

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let repo: ReturnType<typeof repoMock>;
  let users: ReturnType<typeof usersMock>;
  let conflict: ReturnType<typeof conflictMock>;

  beforeEach(async () => {
    repo = repoMock();
    users = usersMock();
    conflict = conflictMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: OrganizationsRepository, useValue: repo },
        { provide: UsersRepository, useValue: users },
        { provide: ConflictResolutionService, useValue: conflict },
      ],
    }).compile();
    service = moduleRef.get(OrganizationsService);
  });

  it('rejects a domain already claimed by another org (ORG_004)', async () => {
    repo.findOrganizationByDomain.mockResolvedValue({ organization: { id: 'other' } });
    await expect(service.addDomain('org1', 'taken.com')).rejects.toMatchObject({ code: 'ORG_004' });
  });

  it('rejects designating an owner who already belongs to an org', async () => {
    users.findByEmail.mockResolvedValue({ id: 'u1' });
    repo.findOrganizationById.mockResolvedValue({ id: 'org1' });
    repo.findMemberByUserId.mockResolvedValue({ organizationId: 'someOrg' });
    await expect(service.designateOwner('org1', 'u@x.com')).rejects.toBeInstanceOf(NodeScopeException);
  });

  it('throws ORG_002 when a user has no membership', async () => {
    repo.findMemberByUserId.mockResolvedValue(null);
    await expect(service.getMyOrganization('u1')).rejects.toMatchObject({ code: 'ORG_002' });
  });

  describe('changeMemberRole', () => {
    it('OWNER can change a MEMBER to ADMIN and emits ORG_MEMBER_UPDATED', async () => {
      repo.findMemberByUserAndOrg.mockResolvedValue({ userId: 'u2', role: 'MEMBER' });
      repo.updateMemberRole.mockResolvedValue({ count: 1 });

      await service.changeMemberRole('org1', 'OWNER', 'u2', 'ADMIN');

      expect(repo.updateMemberRole).toHaveBeenCalledWith('u2', 'org1', 'ADMIN');
      expect(conflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:org:member:updated',
        { userId: 'u2', role: 'ADMIN' },
        'org1',
      );
    });

    it('throws ORG_002 when the target user is not a member', async () => {
      repo.findMemberByUserAndOrg.mockResolvedValue(null);
      await expect(service.changeMemberRole('org1', 'OWNER', 'u-gone', 'MEMBER')).rejects.toMatchObject(
        { code: 'ORG_002' },
      );
    });

    it('ADMIN managing an ADMIN target → ORG_003', async () => {
      repo.findMemberByUserAndOrg.mockResolvedValue({ userId: 'u2', role: 'ADMIN' });
      await expect(
        service.changeMemberRole('org1', 'ADMIN', 'u2', 'MEMBER'),
      ).rejects.toMatchObject({ code: 'ORG_003' });
    });

    it('ADMIN setting nextRole to ADMIN → ORG_003', async () => {
      repo.findMemberByUserAndOrg.mockResolvedValue({ userId: 'u2', role: 'MEMBER' });
      await expect(
        service.changeMemberRole('org1', 'ADMIN', 'u2', 'ADMIN'),
      ).rejects.toMatchObject({ code: 'ORG_003' });
    });

    it('ADMIN setting nextRole to OWNER → ORG_003', async () => {
      repo.findMemberByUserAndOrg.mockResolvedValue({ userId: 'u2', role: 'MEMBER' });
      await expect(
        service.changeMemberRole('org1', 'ADMIN', 'u2', 'OWNER'),
      ).rejects.toMatchObject({ code: 'ORG_003' });
    });

    it('demoting the sole OWNER → ORG_013', async () => {
      repo.findMemberByUserAndOrg.mockResolvedValue({ userId: 'u1', role: 'OWNER' });
      repo.countOwners.mockResolvedValue(1);
      await expect(
        service.changeMemberRole('org1', 'OWNER', 'u1', 'ADMIN'),
      ).rejects.toMatchObject({ code: 'ORG_013' });
    });

    it('demoting an OWNER when another OWNER exists → succeeds', async () => {
      repo.findMemberByUserAndOrg.mockResolvedValue({ userId: 'u2', role: 'OWNER' });
      repo.countOwners.mockResolvedValue(2);
      repo.updateMemberRole.mockResolvedValue({ count: 1 });
      await service.changeMemberRole('org1', 'OWNER', 'u2', 'ADMIN');
      expect(repo.updateMemberRole).toHaveBeenCalledWith('u2', 'org1', 'ADMIN');
    });
  });

  describe('removeMember', () => {
    it('OWNER removes a MEMBER → deleteMember called + ORG_MEMBER_REMOVED emitted', async () => {
      repo.findMemberByUserAndOrg.mockResolvedValue({ userId: 'u2', role: 'MEMBER' });
      repo.deleteMember.mockResolvedValue({ count: 1 });

      await service.removeMember('org1', 'OWNER', 'u2');

      expect(repo.deleteMember).toHaveBeenCalledWith('u2', 'org1');
      expect(conflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:org:member:removed',
        { userId: 'u2' },
        'org1',
      );
      // The removed member's live sockets must be evicted so their fixed socket.data.orgId
      // can no longer receive org broadcasts or ingest metrics into the org they left.
      expect(conflict.evictOrgMember).toHaveBeenCalledWith('org1', 'u2');
    });

    it('throws ORG_002 when target is not a member', async () => {
      repo.findMemberByUserAndOrg.mockResolvedValue(null);
      await expect(service.removeMember('org1', 'OWNER', 'ghost')).rejects.toMatchObject({
        code: 'ORG_002',
      });
    });

    it('ADMIN removing an OWNER → ORG_003', async () => {
      repo.findMemberByUserAndOrg.mockResolvedValue({ userId: 'u1', role: 'OWNER' });
      await expect(service.removeMember('org1', 'ADMIN', 'u1')).rejects.toMatchObject({
        code: 'ORG_003',
      });
    });

    it('removing the sole OWNER → ORG_013', async () => {
      repo.findMemberByUserAndOrg.mockResolvedValue({ userId: 'u1', role: 'OWNER' });
      repo.countOwners.mockResolvedValue(1);
      await expect(service.removeMember('org1', 'OWNER', 'u1')).rejects.toMatchObject({
        code: 'ORG_013',
      });
    });
  });
});
