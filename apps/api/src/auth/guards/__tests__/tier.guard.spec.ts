import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TierGuard } from '../tier.guard';
import { REQUIRED_TIER_KEY } from '../../decorators/require-tier.decorator';

describe('TierGuard', () => {
  let guard: TierGuard;
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;

  const fakeHandler = function fakeHandler() {};
  const FakeController = class FakeController {};

  const buildContext = (user: { tier?: string } | undefined): ExecutionContext =>
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
    guard = new TierGuard(reflector as unknown as Reflector);
  });

  describe('no @RequireTier metadata', () => {
    it('returns true when no required tier is set on handler or class', () => {
      reflector.getAllAndOverride.mockReturnValueOnce(undefined);
      expect(guard.canActivate(buildContext({ tier: 'PERSONAL_FREE' }))).toBe(true);
    });

    it('looks up REQUIRED_TIER_KEY on handler then class', () => {
      reflector.getAllAndOverride.mockReturnValueOnce(undefined);
      guard.canActivate(buildContext({ tier: 'PERSONAL_FREE' }));
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(REQUIRED_TIER_KEY, [
        expect.anything(),
        expect.anything(),
      ]);
    });
  });

  describe('user tier comparison against required tier', () => {
    it('allows access when user tier equals required tier', () => {
      reflector.getAllAndOverride.mockReturnValueOnce('PERSONAL_PAID');
      expect(guard.canActivate(buildContext({ tier: 'PERSONAL_PAID' }))).toBe(true);
    });

    it('allows access when user tier is higher than required tier', () => {
      reflector.getAllAndOverride.mockReturnValueOnce('PERSONAL_PAID');
      expect(guard.canActivate(buildContext({ tier: 'ENTERPRISE' }))).toBe(true);
    });

    it('blocks access when user tier is lower than required tier', () => {
      reflector.getAllAndOverride.mockReturnValueOnce('PERSONAL_PAID');
      expect(() => guard.canActivate(buildContext({ tier: 'PERSONAL_FREE' }))).toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException carrying AUTH_003 INSUFFICIENT_TIER payload', () => {
      reflector.getAllAndOverride.mockReturnValueOnce('ENTERPRISE');
      let captured: unknown;
      try {
        guard.canActivate(buildContext({ tier: 'PERSONAL_FREE' }));
      } catch (err) {
        captured = err;
      }
      expect(captured).toBeInstanceOf(ForbiddenException);
      expect((captured as ForbiddenException).getResponse()).toEqual({
        code: 'AUTH_003',
        message: 'INSUFFICIENT_TIER',
      });
    });
  });

  describe('missing or unknown user tier', () => {
    it('treats a missing request.user as PERSONAL_FREE and blocks higher tiers', () => {
      reflector.getAllAndOverride.mockReturnValueOnce('PERSONAL_PAID');
      expect(() => guard.canActivate(buildContext(undefined))).toThrow(ForbiddenException);
    });

    it('treats a missing user.tier as PERSONAL_FREE and allows PERSONAL_FREE endpoints', () => {
      reflector.getAllAndOverride.mockReturnValueOnce('PERSONAL_FREE');
      expect(guard.canActivate(buildContext({}))).toBe(true);
    });

    it('treats an unknown user.tier value as rank 0 (PERSONAL_FREE equivalent)', () => {
      reflector.getAllAndOverride.mockReturnValueOnce('PERSONAL_PAID');
      expect(() => guard.canActivate(buildContext({ tier: 'GARBAGE' }))).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('unknown required tier — fail-closed behavior', () => {
    // An unrecognized REQUIRED tier name (e.g. a typo in @RequireTier) must
    // DENY access rather than silently grant it. Previously the guard mapped
    // unknown names to rank 0 via `?? 0`, making `userRank < 0` never true, so
    // every caller passed (fail-open). The guard now fails closed.
    it('denies access (throws) when the required tier is not in TIER_ORDER', () => {
      reflector.getAllAndOverride.mockReturnValueOnce('NOT_A_REAL_TIER');
      expect(() => guard.canActivate(buildContext({ tier: 'PERSONAL_FREE' }))).toThrow(
        ForbiddenException,
      );
    });

    it('denies even the highest known user tier when the required tier is unknown', () => {
      reflector.getAllAndOverride.mockReturnValueOnce('TYPO_TIER');
      expect(() => guard.canActivate(buildContext({ tier: 'ENTERPRISE' }))).toThrow(
        ForbiddenException,
      );
    });
  });
});
