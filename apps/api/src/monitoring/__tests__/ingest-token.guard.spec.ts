import { UnauthorizedException } from '@nestjs/common';
import { IngestTokenGuard } from '../ingest/ingest-token.guard';

const ctx = (headers: Record<string, string>) => {
  const req = { headers, ingestOrgId: undefined as string | undefined, ingestSource: undefined as string | undefined };
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
};

/** Stubs for the two agent services added in Spec 8 Phase C Task 5. */
const noAgentTokens = { verifyToken: async () => null } as any;
const noAgentRepo = { touchLastSeen: async () => undefined } as any;

describe('IngestTokenGuard', () => {
  it('accepts a valid x-ingest-token and attaches the org', async () => {
    const guard = new IngestTokenGuard({ verify: async () => 'org-1' } as any, noAgentTokens, noAgentRepo);
    const c = ctx({ 'x-ingest-token': 'good' });
    expect(await guard.canActivate(c)).toBe(true);
    expect(c.switchToHttp().getRequest().ingestOrgId).toBe('org-1');
  });

  it('accepts a Bearer token too', async () => {
    const verify = jest.fn().mockResolvedValue('org-1');
    const guard = new IngestTokenGuard({ verify } as any, noAgentTokens, noAgentRepo);
    await guard.canActivate(ctx({ authorization: 'Bearer abc' }));
    expect(verify).toHaveBeenCalledWith('abc');
  });

  it('rejects a missing or invalid token', async () => {
    const guard = new IngestTokenGuard({ verify: async () => null } as any, noAgentTokens, noAgentRepo);
    await expect(guard.canActivate(ctx({}))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(ctx({ 'x-ingest-token': 'bad' }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts an x-agent-token and sets ingestSource = agent:<id>', async () => {
    const agentTokens = { verifyToken: jest.fn().mockResolvedValue({ orgId: 'org-2', agentId: 'agt-1' }) } as any;
    const agentRepo = { touchLastSeen: jest.fn().mockResolvedValue(undefined) } as any;
    const guard = new IngestTokenGuard({ verify: async () => null } as any, agentTokens, agentRepo);
    const c = ctx({ 'x-agent-token': 'agent-tok' });
    expect(await guard.canActivate(c)).toBe(true);
    const req = c.switchToHttp().getRequest();
    expect(req.ingestOrgId).toBe('org-2');
    expect(req.ingestSource).toBe('agent:agt-1');
    expect(agentRepo.touchLastSeen).toHaveBeenCalledWith('agt-1');
  });
});
