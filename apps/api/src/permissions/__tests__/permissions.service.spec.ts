import { Test } from '@nestjs/testing';
import { ModuleRef } from '@nestjs/core';
import { OrganizationMember } from '@prisma/client';
import { PermissionsService } from '../permissions.service';
import { PermissionsRepository } from '../permissions.repository';
import { AuditService } from '../../audit/audit.service';

describe('PermissionsService', () => {
  let service: PermissionsService;
  const repo = {
    effectiveRootPropertyIds: jest.fn(),
    subtreePropertyIds: jest.fn(),
  } as unknown as jest.Mocked<PermissionsRepository>;
  const mockAudit = { recordCreate: jest.fn(), recordUpdate: jest.fn(), recordDelete: jest.fn() };
  const mockRealtimeService = {
    notifyAccessChanged: jest.fn(),
    emitScoped: jest.fn().mockResolvedValue(undefined),
    emitScopedMulti: jest.fn().mockResolvedValue(undefined),
  };
  const mockModuleRef = { get: jest.fn().mockReturnValue(mockRealtimeService) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PermissionsService,
        { provide: PermissionsRepository, useValue: repo },
        { provide: AuditService, useValue: mockAudit },
        { provide: ModuleRef, useValue: mockModuleRef },
      ],
    }).compile();
    service = moduleRef.get(PermissionsService);
  });

  describe('scope resolution', () => {
    it('scopePropertyIds expands every root subtree and dedupes', async () => {
      repo.effectiveRootPropertyIds.mockResolvedValue(['rootA', 'rootB']);
      repo.subtreePropertyIds.mockImplementation(async (_org, root) =>
        root === 'rootA' ? ['rootA', 'a1'] : ['rootB', 'a1'], // a1 shared
      );
      const ids = await service.scopePropertyIds('org', 'm1');
      expect(ids.sort()).toEqual(['a1', 'rootA', 'rootB']);
    });

    it('inScope is true iff the property is within an expanded subtree', async () => {
      repo.effectiveRootPropertyIds.mockResolvedValue(['rootA']);
      repo.subtreePropertyIds.mockResolvedValue(['rootA', 'a1', 'a2']);
      expect(await service.inScope('org', 'm1', 'a2')).toBe(true);
      expect(await service.inScope('org', 'm1', 'zzz')).toBe(false);
    });
  });

  describe('assertCanConfigure (spec §5)', () => {
    const owner = { id: 'o', organizationId: 'org', role: 'OWNER' } as OrganizationMember;
    const admin = { id: 'a', organizationId: 'org', role: 'ADMIN' } as OrganizationMember;
    const member = { id: 'm', organizationId: 'org', role: 'MEMBER' } as OrganizationMember;

    it('OWNER may configure anything (no scope check)', async () => {
      await expect(service.assertCanConfigure(owner, 'anySite')).resolves.toBeUndefined();
      expect(repo.effectiveRootPropertyIds).not.toHaveBeenCalled();
    });

    it('MEMBER may never configure → ORG_003', async () => {
      await expect(service.assertCanConfigure(member, 'site')).rejects.toMatchObject({ code: 'ORG_003' });
    });

    it('ADMIN may configure in scope, not out of scope (PERM_001)', async () => {
      repo.effectiveRootPropertyIds.mockResolvedValue(['rootA']);
      repo.subtreePropertyIds.mockResolvedValue(['rootA', 'a1']);
      await expect(service.assertCanConfigure(admin, 'a1')).resolves.toBeUndefined();
      await expect(service.assertCanConfigure(admin, 'b9')).rejects.toMatchObject({ code: 'PERM_001' });
    });
  });
});
