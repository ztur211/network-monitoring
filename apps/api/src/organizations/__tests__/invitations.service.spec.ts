import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrgRole } from '@prisma/client';
import { InvitationsService } from '../invitations.service';
import { InvitationsRepository } from '../invitations.repository';
import { OrganizationsRepository } from '../organizations.repository';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

const makeInvitation = (overrides: Partial<{
  id: string;
  email: string;
  token: string;
  acceptedAt: Date | null;
  expiresAt: Date;
  organizationId: string;
  role: OrgRole;
  invitedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}> = {}) => ({
  id: 'inv-1',
  email: 'invitee@example.com',
  token: 'valid-token',
  acceptedAt: null,
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  organizationId: 'org-1',
  role: OrgRole.MEMBER,
  invitedByUserId: 'user-admin',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('InvitationsService', () => {
  let service: InvitationsService;
  let invitationsRepo: jest.Mocked<InvitationsRepository>;
  let orgsRepo: jest.Mocked<OrganizationsRepository>;
  let realtime: jest.Mocked<ConflictResolutionService>;

  beforeEach(async () => {
    const mockInvitationsRepo = {
      create: jest.fn(),
      findByToken: jest.fn(),
      findPendingByOrgAndEmail: jest.fn(),
      listPending: jest.fn(),
      deletePendingByOrgAndEmail: jest.fn(),
      deleteByIdAndOrg: jest.fn(),
      markAccepted: jest.fn(),
    };
    const mockOrgsRepo = {
      createMember: jest.fn(),
      findMemberByUserId: jest.fn(),
    };
    const mockRealtime = {
      emitEntityEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: InvitationsRepository, useValue: mockInvitationsRepo },
        { provide: OrganizationsRepository, useValue: mockOrgsRepo },
        { provide: ConflictResolutionService, useValue: mockRealtime },
      ],
    }).compile();

    service = module.get(InvitationsService);
    invitationsRepo = module.get(InvitationsRepository) as jest.Mocked<InvitationsRepository>;
    orgsRepo = module.get(OrganizationsRepository) as jest.Mocked<OrganizationsRepository>;
    realtime = module.get(ConflictResolutionService) as jest.Mocked<ConflictResolutionService>;
  });

  describe('accept', () => {
    it('throws ORG_009 when token is not found', async () => {
      invitationsRepo.findByToken.mockResolvedValue(null);

      await expect(service.accept('user-1', 'invitee@example.com', 'bad-token')).rejects.toMatchObject({
        code: 'ORG_009',
      } as Partial<NodeScopeException>);
    });

    it('throws ORG_009 when token is already accepted', async () => {
      invitationsRepo.findByToken.mockResolvedValue(makeInvitation({ acceptedAt: new Date() }));

      await expect(service.accept('user-1', 'invitee@example.com', 'valid-token')).rejects.toMatchObject({
        code: 'ORG_009',
      } as Partial<NodeScopeException>);
    });

    it('throws ORG_009 when token is expired', async () => {
      invitationsRepo.findByToken.mockResolvedValue(
        makeInvitation({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.accept('user-1', 'invitee@example.com', 'valid-token')).rejects.toMatchObject({
        code: 'ORG_009',
      } as Partial<NodeScopeException>);
    });

    it('throws ORG_010 when email does not match', async () => {
      invitationsRepo.findByToken.mockResolvedValue(makeInvitation());

      await expect(service.accept('user-1', 'different@example.com', 'valid-token')).rejects.toMatchObject({
        code: 'ORG_010',
      } as Partial<NodeScopeException>);
    });

    it('throws ORG_011 when user is already a member', async () => {
      invitationsRepo.findByToken.mockResolvedValue(makeInvitation());
      orgsRepo.findMemberByUserId.mockResolvedValue({
        id: 'member-1',
        userId: 'user-1',
        organizationId: 'org-1',
        role: OrgRole.MEMBER,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(service.accept('user-1', 'invitee@example.com', 'valid-token')).rejects.toMatchObject({
        code: 'ORG_011',
      } as Partial<NodeScopeException>);
    });

    it('happy-path: calls createMember and markAccepted', async () => {
      const invitation = makeInvitation();
      invitationsRepo.findByToken.mockResolvedValue(invitation);
      orgsRepo.findMemberByUserId.mockResolvedValue(null);
      orgsRepo.createMember.mockResolvedValue({
        id: 'member-new',
        userId: 'user-1',
        organizationId: 'org-1',
        role: OrgRole.MEMBER,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      invitationsRepo.markAccepted.mockResolvedValue({ ...invitation, acceptedAt: new Date() });

      await service.accept('user-1', 'invitee@example.com', 'valid-token');

      expect(orgsRepo.createMember).toHaveBeenCalledWith('user-1', 'org-1', OrgRole.MEMBER);
      expect(invitationsRepo.markAccepted).toHaveBeenCalledWith('inv-1');
      expect(realtime.emitEntityEvent).toHaveBeenCalledTimes(2);
    });
  });

  describe('revoke', () => {
    it('throws ORG_009 when no matching pending invitation is deleted', async () => {
      invitationsRepo.deleteByIdAndOrg.mockResolvedValue({ count: 0 });

      await expect(service.revoke('org-1', 'inv-missing')).rejects.toMatchObject({
        code: 'ORG_009',
      } as Partial<NodeScopeException>);
    });

    it('emits revoked event when successfully deleted', async () => {
      invitationsRepo.deleteByIdAndOrg.mockResolvedValue({ count: 1 });

      await service.revoke('org-1', 'inv-1');

      expect(realtime.emitEntityEvent).toHaveBeenCalledTimes(1);
    });
  });
});
