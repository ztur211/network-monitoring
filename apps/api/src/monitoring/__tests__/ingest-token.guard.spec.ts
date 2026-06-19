import { UnauthorizedException } from '@nestjs/common';
import { IngestTokenGuard } from '../ingest/ingest-token.guard';

const ctx = (headers: Record<string, string>) => {
  const req = { headers, ingestOrgId: undefined as string | undefined };
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
};

describe('IngestTokenGuard', () => {
  it('accepts a valid x-ingest-token and attaches the org', async () => {
    const guard = new IngestTokenGuard({ verify: async () => 'org-1' } as any);
    const c = ctx({ 'x-ingest-token': 'good' });
    expect(await guard.canActivate(c)).toBe(true);
    expect(c.switchToHttp().getRequest().ingestOrgId).toBe('org-1');
  });

  it('accepts a Bearer token too', async () => {
    const verify = jest.fn().mockResolvedValue('org-1');
    const guard = new IngestTokenGuard({ verify } as any);
    await guard.canActivate(ctx({ authorization: 'Bearer abc' }));
    expect(verify).toHaveBeenCalledWith('abc');
  });

  it('rejects a missing or invalid token', async () => {
    const guard = new IngestTokenGuard({ verify: async () => null } as any);
    await expect(guard.canActivate(ctx({}))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(ctx({ 'x-ingest-token': 'bad' }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
