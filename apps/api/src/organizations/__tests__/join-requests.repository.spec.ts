import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { JoinRequestsRepository } from '../join-requests.repository';
import { OrganizationsRepository } from '../organizations.repository';

describe('JoinRequestsRepository (integration)', () => {
  let repo: JoinRequestsRepository;
  let orgRepo: OrganizationsRepository;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [JoinRequestsRepository, OrganizationsRepository, PrismaService],
    }).compile();
    repo = moduleRef.get(JoinRequestsRepository);
    orgRepo = moduleRef.get(OrganizationsRepository);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a join request and finds it as pending by user', async () => {
    const org = await orgRepo.createOrganization({ name: `JROrg-${Date.now()}` });
    const user = await prisma.user.create({
      data: { email: `jr-user-${Date.now()}@x.com`, emailVerified: false, name: 'JRUser' },
    });

    await repo.create(org.id, user.id);

    const found = await repo.findPendingByUser(user.id);
    expect(found).not.toBeNull();
    expect(found!.organizationId).toBe(org.id);
    expect(found!.status).toBe('PENDING');

    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });

  it('listByOrgAndStatus returns only requests with the given status', async () => {
    const org = await orgRepo.createOrganization({ name: `JROrg2-${Date.now()}` });
    const ts = Date.now();

    const user1 = await prisma.user.create({
      data: { email: `jr-u1-${ts}@x.com`, emailVerified: false, name: 'JRU1' },
    });
    const user2 = await prisma.user.create({
      data: { email: `jr-u2-${ts}@x.com`, emailVerified: false, name: 'JRU2' },
    });
    const decider = await prisma.user.create({
      data: { email: `jr-dec-${ts}@x.com`, emailVerified: false, name: 'Decider' },
    });

    const jr1 = await repo.create(org.id, user1.id);
    await repo.create(org.id, user2.id);

    // Approve the first request
    await repo.decide(jr1.id, 'APPROVED', decider.id);

    const pending = await repo.listByOrgAndStatus(org.id, 'PENDING');
    expect(pending).toHaveLength(1);
    expect(pending[0].userId).toBe(user2.id);

    const approved = await repo.listByOrgAndStatus(org.id, 'APPROVED');
    expect(approved).toHaveLength(1);
    expect(approved[0].userId).toBe(user1.id);

    await prisma.user.delete({ where: { id: user1.id } });
    await prisma.user.delete({ where: { id: user2.id } });
    await prisma.user.delete({ where: { id: decider.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });

  it('decide flips the status and sets decidedAt and decidedByUserId', async () => {
    const org = await orgRepo.createOrganization({ name: `JROrg3-${Date.now()}` });
    const ts = Date.now();
    const user = await prisma.user.create({
      data: { email: `jr-flip-${ts}@x.com`, emailVerified: false, name: 'Flip' },
    });
    const decider = await prisma.user.create({
      data: { email: `jr-flippd-${ts}@x.com`, emailVerified: false, name: 'FlipDec' },
    });

    const jr = await repo.create(org.id, user.id);
    expect(jr.status).toBe('PENDING');
    expect(jr.decidedAt).toBeNull();

    const decided = await repo.decide(jr.id, 'DENIED', decider.id);
    expect(decided.status).toBe('DENIED');
    expect(decided.decidedByUserId).toBe(decider.id);
    expect(decided.decidedAt).not.toBeNull();

    await prisma.user.delete({ where: { id: user.id } });
    await prisma.user.delete({ where: { id: decider.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });

  it('findByIdAndOrg returns null when the request belongs to a different org', async () => {
    const org1 = await orgRepo.createOrganization({ name: `JROrg4a-${Date.now()}` });
    const org2 = await orgRepo.createOrganization({ name: `JROrg4b-${Date.now()}` });
    const ts = Date.now();
    const user = await prisma.user.create({
      data: { email: `jr-wrong-org-${ts}@x.com`, emailVerified: false, name: 'WrongOrg' },
    });

    const jr = await repo.create(org1.id, user.id);

    const wrongOrgLookup = await repo.findByIdAndOrg(jr.id, org2.id);
    expect(wrongOrgLookup).toBeNull();

    const correctOrgLookup = await repo.findByIdAndOrg(jr.id, org1.id);
    expect(correctOrgLookup).not.toBeNull();

    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org1.id } });
    await prisma.organization.delete({ where: { id: org2.id } });
  });
});
