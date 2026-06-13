import { ExecutionContext } from '@nestjs/common';
import { SuperAdminGuard } from '../guards/super-admin.guard';

function ctxFor(request: any): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
}

describe('SuperAdminGuard', () => {
  const guard = new SuperAdminGuard();

  it('allows a super-admin', () => {
    expect(guard.canActivate(ctxFor({ user: { isSuperAdmin: true } }))).toBe(true);
  });

  it('rejects a non-super-admin with ORG_007', () => {
    expect(() => guard.canActivate(ctxFor({ user: { isSuperAdmin: false } }))).toThrow();
  });
});
