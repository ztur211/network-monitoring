import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentRepository } from '../agent.repository';

/** Integration (real test DB). Named .repository.spec.ts → jest.integration.config. */
describe('AgentRepository (integration)', () => {
  let repo: AgentRepository;
  let prisma: PrismaService;
  let orgId: string;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      providers: [AgentRepository, PrismaService],
    }).compile();
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
        data: { name: `A${Date.now()}${Math.floor(performance.now())}` },
      })
    ).id;
  });
  afterEach(async () => {
    // Agents/codes cascade-delete with the org (onDelete: Cascade).
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it('creates an agent, finds it by id and token hash, lists, touches last-seen, sets status', async () => {
    const a = await repo.create({
      organizationId: orgId,
      name: 'edge',
      platform: 'linux',
      version: '0.0.0',
      tokenHash: `h${Date.now()}`,
      createdByMemberId: null,
    });

    // create defaults to APPROVED
    expect(a.status).toBe('APPROVED');
    expect(a.lastSeenAt).toBeNull();

    // findById
    expect((await repo.findById(a.id))?.id).toBe(a.id);

    // findByTokenHash
    expect((await repo.findByTokenHash(a.tokenHash))?.id).toBe(a.id);
    expect(await repo.findByTokenHash('nope')).toBeNull();

    // listByOrg
    expect((await repo.listByOrg(orgId)).map((x) => x.id)).toEqual([a.id]);

    // touchLastSeen
    await repo.touchLastSeen(a.id);
    expect((await repo.findById(a.id))?.lastSeenAt).not.toBeNull();

    // setStatus
    await repo.setStatus(a.id, 'REVOKED');
    expect((await repo.findById(a.id))?.status).toBe('REVOKED');
  });

  it('lists agents for an org newest-first and isolates by org', async () => {
    const a1 = await repo.create({
      organizationId: orgId,
      name: 'a1',
      platform: null,
      version: null,
      tokenHash: `h1${Date.now()}`,
      createdByMemberId: null,
    });
    // ensure a strictly-later createdAt for deterministic ordering
    await new Promise((r) => setTimeout(r, 5));
    const a2 = await repo.create({
      organizationId: orgId,
      name: 'a2',
      platform: null,
      version: null,
      tokenHash: `h2${Date.now()}`,
      createdByMemberId: null,
    });

    const ids = (await repo.listByOrg(orgId)).map((x) => x.id);
    expect(ids).toEqual([a2.id, a1.id]); // desc by createdAt

    // a different org sees none of these
    const otherOrg = await prisma.organization.create({
      data: { name: `B${Date.now()}${Math.floor(performance.now())}` },
    });
    try {
      expect(await repo.listByOrg(otherOrg.id)).toEqual([]);
    } finally {
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    }
  });

  it('delete removes the agent row', async () => {
    const a = await repo.create({
      organizationId: orgId,
      name: 'gone',
      platform: null,
      version: null,
      tokenHash: `hd${Date.now()}`,
      createdByMemberId: null,
    });
    await repo.delete(a.id);
    expect(await repo.findById(a.id)).toBeNull();
  });

  it('enrollment-code lifecycle: create → findValid → markUsed; expired/used are not valid', async () => {
    const codeHash = `c${Date.now()}`;
    const code = await repo.createCode({
      organizationId: orgId,
      codeHash,
      expiresAt: new Date(Date.now() + 60_000),
      createdByMemberId: null,
    });
    expect(code.usedAt).toBeNull();

    // findValidCode returns the unused, unexpired row
    expect((await repo.findValidCode(codeHash))?.id).toBe(code.id);

    // mark used → no longer valid
    await repo.markCodeUsed(code.id);
    expect(await repo.findValidCode(codeHash)).toBeNull();

    // an expired code is never valid
    const expiredHash = `e${Date.now()}`;
    await repo.createCode({
      organizationId: orgId,
      codeHash: expiredHash,
      expiresAt: new Date(Date.now() - 1000),
      createdByMemberId: null,
    });
    expect(await repo.findValidCode(expiredHash)).toBeNull();
  });
});
