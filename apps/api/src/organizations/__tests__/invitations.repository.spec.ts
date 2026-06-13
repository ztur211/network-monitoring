import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { InvitationsRepository } from '../invitations.repository';
import { OrganizationsRepository } from '../organizations.repository';

describe('InvitationsRepository (integration)', () => {
  let repo: InvitationsRepository;
  let orgRepo: OrganizationsRepository;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [InvitationsRepository, OrganizationsRepository, PrismaService],
    }).compile();
    repo = moduleRef.get(InvitationsRepository);
    orgRepo = moduleRef.get(OrganizationsRepository);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates an invitation and finds it by token', async () => {
    const org = await orgRepo.createOrganization({ name: `InvOrg-${Date.now()}` });
    const token = `tok-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 86_400_000);

    const inv = await repo.create({
      organizationId: org.id,
      email: `inv-${Date.now()}@test.com`,
      role: 'MEMBER',
      token,
      expiresAt,
      invitedByUserId: null,
    });

    const found = await repo.findByToken(token);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(inv.id);
    expect(found!.organizationId).toBe(org.id);

    await prisma.organization.delete({ where: { id: org.id } });
  });

  it('findPendingByOrgAndEmail returns null when invitation has been accepted', async () => {
    const org = await orgRepo.createOrganization({ name: `InvOrg2-${Date.now()}` });
    const email = `inv2-${Date.now()}@test.com`;
    const token = `tok2-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 86_400_000);

    const inv = await repo.create({
      organizationId: org.id,
      email,
      role: 'MEMBER',
      token,
      expiresAt,
      invitedByUserId: null,
    });

    // Before accepting — should be found
    const pending = await repo.findPendingByOrgAndEmail(org.id, email);
    expect(pending).not.toBeNull();

    // Mark accepted
    await repo.markAccepted(inv.id);

    // After accepting — should be excluded
    const afterAccepted = await repo.findPendingByOrgAndEmail(org.id, email);
    expect(afterAccepted).toBeNull();

    await prisma.organization.delete({ where: { id: org.id } });
  });

  it('listPending returns only pending invitations for the org', async () => {
    const org = await orgRepo.createOrganization({ name: `InvOrg3-${Date.now()}` });
    const expiresAt = new Date(Date.now() + 86_400_000);
    const ts = Date.now();

    const inv1 = await repo.create({
      organizationId: org.id,
      email: `pending1-${ts}@test.com`,
      role: 'MEMBER',
      token: `tok-p1-${ts}`,
      expiresAt,
      invitedByUserId: null,
    });
    await repo.create({
      organizationId: org.id,
      email: `pending2-${ts}@test.com`,
      role: 'ADMIN',
      token: `tok-p2-${ts}`,
      expiresAt,
      invitedByUserId: null,
    });
    // Accept one so it drops off the list
    await repo.markAccepted(inv1.id);

    const list = await repo.listPending(org.id);
    expect(list).toHaveLength(1);
    expect(list[0].email).toBe(`pending2-${ts}@test.com`);

    await prisma.organization.delete({ where: { id: org.id } });
  });

  it('deletePendingByOrgAndEmail removes only pending invitations', async () => {
    const org = await orgRepo.createOrganization({ name: `InvOrg4-${Date.now()}` });
    const email = `del-${Date.now()}@test.com`;
    const expiresAt = new Date(Date.now() + 86_400_000);
    const ts = Date.now();

    await repo.create({
      organizationId: org.id,
      email,
      role: 'MEMBER',
      token: `tok-del1-${ts}`,
      expiresAt,
      invitedByUserId: null,
    });

    const result = await repo.deletePendingByOrgAndEmail(org.id, email);
    expect(result.count).toBe(1);

    const remaining = await repo.findPendingByOrgAndEmail(org.id, email);
    expect(remaining).toBeNull();

    await prisma.organization.delete({ where: { id: org.id } });
  });

  it('deleteByIdAndOrg removes a specific pending invitation', async () => {
    const org = await orgRepo.createOrganization({ name: `InvOrg5-${Date.now()}` });
    const ts = Date.now();
    const inv = await repo.create({
      organizationId: org.id,
      email: `specific-${ts}@test.com`,
      role: 'MEMBER',
      token: `tok-specific-${ts}`,
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: null,
    });

    const result = await repo.deleteByIdAndOrg(inv.id, org.id);
    expect(result.count).toBe(1);

    const found = await repo.findByToken(`tok-specific-${ts}`);
    expect(found).toBeNull();

    await prisma.organization.delete({ where: { id: org.id } });
  });

  it('countOwners returns the correct OWNER count for an org', async () => {
    const org = await orgRepo.createOrganization({ name: `CountOwners-${Date.now()}` });
    const ts = Date.now();

    const owner1 = await prisma.user.create({
      data: { email: `owner1-${ts}@x.com`, emailVerified: false, name: 'Owner1' },
    });
    const member1 = await prisma.user.create({
      data: { email: `member1-${ts}@x.com`, emailVerified: false, name: 'Member1' },
    });

    await orgRepo.createMember(owner1.id, org.id, 'OWNER');
    await orgRepo.createMember(member1.id, org.id, 'MEMBER');

    const count = await orgRepo.countOwners(org.id);
    expect(count).toBe(1);

    // Cleanup: cascade from org delete handles members
    await prisma.user.delete({ where: { id: owner1.id } });
    await prisma.user.delete({ where: { id: member1.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });
});
