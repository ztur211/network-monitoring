import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JoinRequestStatus, OrgRole } from '@prisma/client';
import { JoinRequestsService } from '../join-requests.service';
import { JoinRequestsRepository } from '../join-requests.repository';
import { OrganizationsRepository } from '../organizations.repository';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

const makeJoinRequest = (overrides: Partial<{
  id: string;
  organizationId: string;
  userId: string;
  status: JoinRequestStatus;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}> = {}) => ({
  id: 'jr-1',
  organizationId: 'org-1',
  userId: 'user-1',
  status: 'PENDING' as JoinRequestStatus,
  decidedByUserId: null,
  decidedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeDomainMatch = (organizationId = 'org-1') => ({
  id: 'domain-1',
  organizationId,
  domain: 'acme.test',
  verified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  organization: {
    id: organizationId,
    name: 'Acme Corp',
    namingPattern: null,
    namingMaxLen: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
});

const makeMember = (userId = 'user-1', organizationId = 'org-1') => ({
  id: 'member-1',
  userId,
  organizationId,
  role: OrgRole.MEMBER,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('JoinRequestsService', () => {
  let service: JoinRequestsService;
  let requestsRepo: jest.Mocked<JoinRequestsRepository>;
  let orgsRepo: jest.Mocked<OrganizationsRepository>;
  let realtime: jest.Mocked<ConflictResolutionService>;

  beforeEach(async () => {
    const mockRequestsRepo = {
      create: jest.fn(),
      findPendingByUser: jest.fn(),
      findByIdAndOrg: jest.fn(),
      listByOrgAndStatus: jest.fn(),
      decide: jest.fn(),
    };
    const mockOrgsRepo = {
      findMemberByUserId: jest.fn(),
      findOrganizationByDomain: jest.fn(),
      createMember: jest.fn(),
    };
    const mockRealtime = {
      emitEntityEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JoinRequestsService,
        { provide: JoinRequestsRepository, useValue: mockRequestsRepo },
        { provide: OrganizationsRepository, useValue: mockOrgsRepo },
        { provide: ConflictResolutionService, useValue: mockRealtime },
      ],
    }).compile();

    service = module.get(JoinRequestsService);
    requestsRepo = module.get(JoinRequestsRepository) as jest.Mocked<JoinRequestsRepository>;
    orgsRepo = module.get(OrganizationsRepository) as jest.Mocked<OrganizationsRepository>;
    realtime = module.get(ConflictResolutionService) as jest.Mocked<ConflictResolutionService>;
  });

  describe('submit', () => {
    it('throws ORG_011 when user is already a member', async () => {
      orgsRepo.findMemberByUserId.mockResolvedValue(makeMember());

      await expect(service.submit('user-1', 'user@acme.test')).rejects.toMatchObject({
        code: 'ORG_011',
      } as Partial<NodeScopeException>);
    });

    it('throws ORG_014 when no org matches the user email domain', async () => {
      orgsRepo.findMemberByUserId.mockResolvedValue(null);
      orgsRepo.findOrganizationByDomain.mockResolvedValue(null);

      await expect(service.submit('user-1', 'user@unknown.test')).rejects.toMatchObject({
        code: 'ORG_014',
      } as Partial<NodeScopeException>);
    });

    it('throws ORG_015 when a pending request already exists', async () => {
      orgsRepo.findMemberByUserId.mockResolvedValue(null);
      orgsRepo.findOrganizationByDomain.mockResolvedValue(makeDomainMatch());
      requestsRepo.findPendingByUser.mockResolvedValue(makeJoinRequest());

      await expect(service.submit('user-1', 'user@acme.test')).rejects.toMatchObject({
        code: 'ORG_015',
      } as Partial<NodeScopeException>);
    });

    it('happy path: creates join request with matched org id', async () => {
      const domainMatch = makeDomainMatch('org-42');
      orgsRepo.findMemberByUserId.mockResolvedValue(null);
      orgsRepo.findOrganizationByDomain.mockResolvedValue(domainMatch);
      requestsRepo.findPendingByUser.mockResolvedValue(null);
      requestsRepo.create.mockResolvedValue(makeJoinRequest({ organizationId: 'org-42' }));

      await service.submit('user-1', 'user@acme.test');

      expect(requestsRepo.create).toHaveBeenCalledWith('org-42', 'user-1');
      expect(realtime.emitEntityEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('decide', () => {
    it('throws ORG_012 when request not found', async () => {
      requestsRepo.findByIdAndOrg.mockResolvedValue(null);

      await expect(service.decide('org-1', 'jr-missing', true, 'admin-1')).rejects.toMatchObject({
        code: 'ORG_012',
      } as Partial<NodeScopeException>);
    });

    it('throws ORG_012 when request exists but is not PENDING', async () => {
      requestsRepo.findByIdAndOrg.mockResolvedValue(makeJoinRequest({ status: 'APPROVED' as JoinRequestStatus }));

      await expect(service.decide('org-1', 'jr-1', true, 'admin-1')).rejects.toMatchObject({
        code: 'ORG_012',
      } as Partial<NodeScopeException>);
    });

    it('approve: creates member with MEMBER role and calls decide with APPROVED', async () => {
      requestsRepo.findByIdAndOrg.mockResolvedValue(makeJoinRequest());
      orgsRepo.findMemberByUserId.mockResolvedValue(null);
      orgsRepo.createMember.mockResolvedValue(makeMember());
      requestsRepo.decide.mockResolvedValue(makeJoinRequest({ status: 'APPROVED' as JoinRequestStatus }));

      await service.decide('org-1', 'jr-1', true, 'admin-1');

      expect(orgsRepo.createMember).toHaveBeenCalledWith('user-1', 'org-1', 'MEMBER');
      expect(requestsRepo.decide).toHaveBeenCalledWith('jr-1', 'APPROVED', 'admin-1');
      expect(realtime.emitEntityEvent).toHaveBeenCalledTimes(2);
    });

    it('deny: does NOT create member and calls decide with DENIED', async () => {
      requestsRepo.findByIdAndOrg.mockResolvedValue(makeJoinRequest());
      requestsRepo.decide.mockResolvedValue(makeJoinRequest({ status: 'DENIED' as JoinRequestStatus }));

      await service.decide('org-1', 'jr-1', false, 'admin-1');

      expect(orgsRepo.createMember).not.toHaveBeenCalled();
      expect(requestsRepo.decide).toHaveBeenCalledWith('jr-1', 'DENIED', 'admin-1');
      expect(realtime.emitEntityEvent).toHaveBeenCalledTimes(1);
    });
  });
});
