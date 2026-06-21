import { UnauthorizedException } from '@nestjs/common';
import { AgentTokenGuard } from '../agent-token.guard';

const ctx = (headers: Record<string, string>) => {
  const req = { headers, agent: undefined as { orgId: string; agentId: string } | undefined };
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
};

describe('AgentTokenGuard', () => {
  it('attaches {orgId, agentId} and bumps last-seen', async () => {
    const tokens = { verifyToken: jest.fn().mockResolvedValue({ orgId: 'o', agentId: 'a' }) };
    const repo = { touchLastSeen: jest.fn().mockResolvedValue(undefined) };
    const redis = { set: jest.fn().mockResolvedValue('OK') }; // acquires the throttle window
    const guard = new AgentTokenGuard(tokens as any, repo as any, redis as any);

    const c = ctx({ 'x-agent-token': 'good' });
    expect(await guard.canActivate(c)).toBe(true);
    expect(tokens.verifyToken).toHaveBeenCalledWith('good');
    expect(c.switchToHttp().getRequest().agent).toEqual({ orgId: 'o', agentId: 'a' });
    expect(repo.touchLastSeen).toHaveBeenCalledWith('a');
  });

  it('rejects an invalid/revoked token and does not bump last-seen', async () => {
    const repo = { touchLastSeen: jest.fn() };
    const guard = new AgentTokenGuard(
      { verifyToken: async () => null } as any,
      repo as any,
      { set: jest.fn() } as any,
    );
    await expect(
      guard.canActivate(ctx({ 'x-agent-token': 'bad' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.touchLastSeen).not.toHaveBeenCalled();
  });

  it('rejects when the header is missing entirely', async () => {
    const verifyToken = jest.fn().mockResolvedValue(null);
    const guard = new AgentTokenGuard({ verifyToken } as any, { touchLastSeen: jest.fn() } as any, { set: jest.fn() } as any);
    await expect(guard.canActivate(ctx({}))).rejects.toBeInstanceOf(UnauthorizedException);
    // missing header is passed to verifyToken as '' (never undefined)
    expect(verifyToken).toHaveBeenCalledWith('');
  });

  it('throttles last-seen: skips the Postgres write when the Redis window is already held', async () => {
    const tokens = { verifyToken: jest.fn().mockResolvedValue({ orgId: 'o', agentId: 'a' }) };
    const repo = { touchLastSeen: jest.fn() };
    const redis = { set: jest.fn().mockResolvedValue(null) }; // key already set → within window
    const guard = new AgentTokenGuard(tokens as any, repo as any, redis as any);

    expect(await guard.canActivate(ctx({ 'x-agent-token': 'good' }))).toBe(true);
    expect(redis.set).toHaveBeenCalled();
    expect(repo.touchLastSeen).not.toHaveBeenCalled();
  });
});
