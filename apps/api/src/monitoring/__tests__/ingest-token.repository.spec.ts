import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { IngestTokenService } from '../ingest/ingest-token.service';

/** Integration (real test DB :5433). Named .repository.spec.ts → jest.integration.config. */
describe('IngestTokenService (integration)', () => {
  let svc: IngestTokenService;
  let prisma: PrismaService;
  let orgId: string;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ providers: [IngestTokenService, PrismaService] }).compile();
    svc = ref.get(IngestTokenService);
    prisma = ref.get(PrismaService);
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    orgId = (await prisma.organization.create({ data: { name: `T${Date.now()}${Math.floor(performance.now())}` } })).id;
  });
  afterEach(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it('mints a token that verifies back to the org; rotation invalidates the old one', async () => {
    const t1 = await svc.createOrRotate(orgId);
    expect(await svc.verify(t1)).toBe(orgId);

    const t2 = await svc.createOrRotate(orgId);
    expect(t2).not.toBe(t1);
    expect(await svc.verify(t2)).toBe(orgId);
    expect(await svc.verify(t1)).toBeNull(); // old token no longer valid
    expect(await svc.verify('garbage')).toBeNull();
    expect(await svc.verify('')).toBeNull();
  });

  it('stores only the hash, never the secret', async () => {
    const secret = await svc.createOrRotate(orgId);
    const row = await prisma.monitoringIngestToken.findUniqueOrThrow({ where: { organizationId: orgId } });
    expect(row.tokenHash).not.toBe(secret);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });
});
