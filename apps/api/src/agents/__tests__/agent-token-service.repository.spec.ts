import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentRepository } from '../agent.repository';
import { AgentTokenService } from '../agent-token.service';

/**
 * Integration (real test DB). DB-backed AgentTokenService.
 *
 * Named `*.repository.spec.ts` so it runs under jest.integration.config (which
 * matches `.*\.repository\.spec\.ts$`). A `.service.spec.ts` name would instead
 * be collected by the unit suite, which is not given a DB — mirrors the
 * ingest-token.service precedent (tested via ingest-token.repository.spec.ts).
 */
describe('AgentTokenService (integration)', () => {
  let svc: AgentTokenService;
  let repo: AgentRepository;
  let prisma: PrismaService;
  let orgId: string;
  // createdByMemberId is nullable; seed with null (no member coupling needed).
  const memberId: string | null = null;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      providers: [AgentTokenService, AgentRepository, PrismaService],
    }).compile();
    svc = ref.get(AgentTokenService);
    repo = ref.get(AgentRepository);
    prisma = ref.get(PrismaService);
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    orgId = (
      await prisma.organization.create({
        data: { name: `S${Date.now()}${Math.floor(performance.now())}` },
      })
    ).id;
  });
  afterEach(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it('generate code → enroll → verify; the code is single-use; revoke invalidates the token', async () => {
    const code = await svc.generateEnrollmentCode(orgId, memberId);
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);

    const { agentId, token } = await svc.enroll(code, {
      name: 'edge',
      platform: 'linux',
      version: '0.0.0',
    });
    expect(typeof token).toBe('string');

    // verifies back to {orgId, agentId}
    expect(await svc.verifyToken(token)).toEqual({ orgId, agentId });

    // single-use: re-enrolling with the same code is rejected
    await expect(
      svc.enroll(code, { name: 'x', platform: 'linux', version: '0' }),
    ).rejects.toThrow();

    // revoke invalidates the token
    await repo.setStatus(agentId, 'REVOKED');
    expect(await svc.verifyToken(token)).toBeNull();
  });

  it('rejects an invalid or expired enrollment code', async () => {
    await expect(
      svc.enroll('not-a-real-code', { name: 'x', platform: 'linux', version: '0' }),
    ).rejects.toThrow();
  });

  it('verifyToken returns null for empty/unknown tokens and only stores the hash', async () => {
    expect(await svc.verifyToken('')).toBeNull();
    expect(await svc.verifyToken('garbage-token')).toBeNull();

    const code = await svc.generateEnrollmentCode(orgId, memberId);
    const { agentId, token } = await svc.enroll(code, {
      name: 'edge',
      platform: 'linux',
      version: '0.0.0',
    });

    // The plaintext token is never persisted — only its sha256 hash.
    const row = await prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
