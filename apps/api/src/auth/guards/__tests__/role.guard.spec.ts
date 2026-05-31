import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleGuard } from '../role.guard';
import { REQUIRED_ROLE_KEY } from '../../decorators/require-role.decorator';

describe('RoleGuard', () => {
  let guard: RoleGuard;
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;

  const fakeHandler = function fakeHandler() {};
  const FakeController = class FakeController {};

  const buildContext = (user: { orgRole?: string } | undefined): ExecutionContext =>
    ({
      getHandler: () => fakeHandler,
      getClass: () => FakeController,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
    guard = new RoleGuard(reflector as unknown as Reflector);
  });

  describe('no @RequireRole metadata', () => {
    it('returns true when no required role is set on handler or class', () => {
      reflector.getAllAndOverride.mockReturnValueOnce(undefined);
      expect(guard.canActivate(buildContext({ orgRole: undefined }))).toBe(true);
    });

    it('looks up REQUIRED_ROLE_KEY on handler then class', () => {
      reflector.getAllAndOverride.mockReturnValueOnce(undefined);
      guard.canActivate(buildContext({ orgRole: 'admin' }));
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(REQUIRED_ROLE_KEY, [
        expect.anything(),
        expect.anything(),
      ]);
    });
  });

  describe('@RequireRole metadata is set', () => {
    // Organization plugin is post-MVP (Priority 4). MVP behavior is "any non-
    // empty orgRole passes" — when the plugin ships and per-role distinctions
    // matter, these specs must extend to assert role-specific access (e.g.
    // member cannot access an admin-only endpoint).
    it('allows access when the user has any non-empty orgRole', () => {
      reflector.getAllAndOverride.mockReturnValueOnce('admin');
      expect(guard.canActivate(buildContext({ orgRole: 'member' }))).toBe(true);
    });

    it('blocks access when the user has no orgRole', () => {
      reflector.getAllAndOverride.mockReturnValueOnce('admin');
      expect(() => guard.canActivate(buildContext({ orgRole: undefined }))).toThrow(
        ForbiddenException,
      );
    });

    it('blocks access when request.user is missing entirely', () => {
      reflector.getAllAndOverride.mockReturnValueOnce('admin');
      expect(() => guard.canActivate(buildContext(undefined))).toThrow(ForbiddenException);
    });

    it('treats an empty-string orgRole as missing and blocks access', () => {
      reflector.getAllAndOverride.mockReturnValueOnce('admin');
      expect(() => guard.canActivate(buildContext({ orgRole: '' }))).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException carrying AUTH_004 INSUFFICIENT_ROLE payload', () => {
      reflector.getAllAndOverride.mockReturnValueOnce('admin');
      let captured: unknown;
      try {
        guard.canActivate(buildContext({ orgRole: undefined }));
      } catch (err) {
        captured = err;
      }
      expect(captured).toBeInstanceOf(ForbiddenException);
      expect((captured as ForbiddenException).getResponse()).toEqual({
        code: 'AUTH_004',
        message: 'INSUFFICIENT_ROLE',
      });
    });
  });
});
