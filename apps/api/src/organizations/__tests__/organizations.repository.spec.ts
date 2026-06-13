import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationsRepository } from '../organizations.repository';

describe('OrganizationsRepository (integration)', () => {
  let repo: OrganizationsRepository;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [OrganizationsRepository, PrismaService],
    }).compile();
    repo = moduleRef.get(OrganizationsRepository);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates an org, adds a domain, and finds the org by domain', async () => {
    const org = await repo.createOrganization({ name: `Acme ${Date.now()}` });
    const domain = `acme-${Date.now()}.com`;
    await repo.addDomain(org.id, domain);

    const found = await repo.findOrganizationByDomain(domain);
    expect(found?.organization.id).toBe(org.id);

    await prisma.organization.delete({ where: { id: org.id } });
  });

  it('creates a member and finds it by userId (one org per user)', async () => {
    const user = await prisma.user.create({
      data: { email: `m-${Date.now()}@x.com`, emailVerified: false, name: 'M' },
    });
    const org = await repo.createOrganization({ name: `Org ${Date.now()}` });
    await repo.createMember(user.id, org.id, 'OWNER');

    const member = await repo.findMemberByUserId(user.id);
    expect(member?.organizationId).toBe(org.id);
    expect(member?.role).toBe('OWNER');

    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });
});
