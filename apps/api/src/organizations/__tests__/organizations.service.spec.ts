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
});
const usersMock = () => ({ findByEmail: jest.fn() });
const conflictMock = () => ({ buildUpdatePayload: jest.fn() });

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let repo: ReturnType<typeof repoMock>;
  let users: ReturnType<typeof usersMock>;

  beforeEach(async () => {
    repo = repoMock();
    users = usersMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: OrganizationsRepository, useValue: repo },
        { provide: UsersRepository, useValue: users },
        { provide: ConflictResolutionService, useValue: conflictMock() },
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
});
