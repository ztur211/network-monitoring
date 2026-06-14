import { Test } from '@nestjs/testing';
import { Team } from '@prisma/client';
import { PermissionsService } from '../permissions.service';
import { PermissionsRepository } from '../permissions.repository';
import { AuditService } from '../../audit/audit.service';
import type { OrgMemberContext } from '../../organizations/org-context.types';

describe('PermissionsService delegation (spec §7)', () => {
  let service: PermissionsService;
  const repo = {
    effectiveRootPropertyIds: jest.fn(),
    subtreePropertyIds: jest.fn(),
  } as unknown as jest.Mocked<PermissionsRepository>;
  const mockAudit = { recordCreate: jest.fn(), recordUpdate: jest.fn(), recordDelete: jest.fn() };
  const owner = { id: 'o', organizationId: 'org', role: 'OWNER' } as OrgMemberContext;
  const admin = { id: 'a', organizationId: 'org', role: 'ADMIN' } as OrgMemberContext;
  const member = { id: 'm', organizationId: 'org', role: 'MEMBER' } as OrgMemberContext;

  beforeEach(async () => {
    jest.clearAllMocks();
    const ref = await Test.createTestingModule({
      providers: [
        PermissionsService,
        { provide: PermissionsRepository, useValue: repo },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = ref.get(PermissionsService);
    // admin scope = subtree of rootA = {rootA, a1}
    repo.effectiveRootPropertyIds.mockResolvedValue(['rootA']);
    repo.subtreePropertyIds.mockResolvedValue(['rootA', 'a1']);
  });

  it('assertWithinGrantorScope: OWNER unlimited; ADMIN ⊆ own scope; beyond → PERM_002', async () => {
    await expect(service.assertWithinGrantorScope(owner, ['anything'])).resolves.toBeUndefined();
    await expect(service.assertWithinGrantorScope(admin, ['a1'])).resolves.toBeUndefined();
    await expect(service.assertWithinGrantorScope(admin, ['rootA', 'b9'])).rejects.toMatchObject({ code: 'PERM_002' });
  });

  it('assertCanManageMember: OWNER→anyone; ADMIN→MEMBER only; ADMIN→ADMIN/OWNER → PERM_003', () => {
    expect(() => service.assertCanManageMember(owner, admin)).not.toThrow();
    expect(() => service.assertCanManageMember(admin, member)).not.toThrow();
    expect(() => service.assertCanManageMember(admin, owner)).toThrow(expect.objectContaining({ code: 'PERM_003' }));
    expect(() => service.assertCanManageMember(admin, admin)).toThrow(expect.objectContaining({ code: 'PERM_003' }));
  });

  it('assertCanManageTeamStructure: creating ADMIN with all sites in scope; non-creator or out-of-scope → PERM_003/PERM_002', async () => {
    const own = { id: 't1', creatorMemberId: 'a' } as Team;
    const other = { id: 't2', creatorMemberId: 'someoneElse' } as Team;
    await expect(service.assertCanManageTeamStructure(admin, own, ['a1'])).resolves.toBeUndefined();
    await expect(service.assertCanManageTeamStructure(admin, other, ['a1'])).rejects.toMatchObject({ code: 'PERM_003' });
    await expect(service.assertCanManageTeamStructure(admin, own, ['b9'])).rejects.toMatchObject({ code: 'PERM_002' });
    await expect(service.assertCanManageTeamStructure(owner, other, ['anywhere'])).resolves.toBeUndefined();
  });

  it('assertCanManageTeamMembership: ADMIN may manage any team wholly ⊆ scope; out-of-scope team → PERM_003', async () => {
    await expect(service.assertCanManageTeamMembership(admin, ['a1'])).resolves.toBeUndefined();
    await expect(service.assertCanManageTeamMembership(admin, ['a1', 'b9'])).rejects.toMatchObject({ code: 'PERM_003' });
    await expect(service.assertCanManageTeamMembership(owner, ['anywhere'])).resolves.toBeUndefined();
  });
});
