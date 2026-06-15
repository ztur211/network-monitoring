import { ExecutionContext } from '@nestjs/common';
import { OrgContextGuard } from '../guards/org-context.guard';
import { OrganizationsRepository } from '../organizations.repository';

function ctxFor(request: any): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
}

describe('OrgContextGuard', () => {
  it('attaches request.orgMember from the session user membership', async () => {
    const repo = { findMemberByUserId: jest.fn().mockResolvedValue({ id: 'm1', organizationId: 'org1', role: 'ADMIN' }) };
    const guard = new OrgContextGuard(repo as unknown as OrganizationsRepository);
    const request: any = { user: { id: 'u1' } };
    await guard.canActivate(ctxFor(request));
    expect(request.orgMember).toEqual({ id: 'm1', organizationId: 'org1', role: 'ADMIN' });
  });

  it('attaches null when the user has no membership (does not throw)', async () => {
    const repo = { findMemberByUserId: jest.fn().mockResolvedValue(null) };
    const guard = new OrgContextGuard(repo as unknown as OrganizationsRepository);
    const request: any = { user: { id: 'u1' } };
    const result = await guard.canActivate(ctxFor(request));
    expect(result).toBe(true);
    expect(request.orgMember).toBeNull();
  });
});
