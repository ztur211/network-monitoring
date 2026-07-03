import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { AI_PROVIDER_TOKEN } from '../../ai/adapters/ai-provider.interface';
import { PrismaService } from '../../prisma/prisma.service';

const mockAdapter = { complete: jest.fn(), stream: jest.fn() };

/**
 * Proves the whole app boots and round-trips a blob with STORAGE_DRIVER=fs — no
 * MinIO/S3. A fresh sign-up creates only a user, so (like the export e2e) the org +
 * OWNER membership + building are created via prisma before the upload/download.
 */
describe('App boots with STORAGE_DRIVER=fs (filesystem storage)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fsRoot: string;
  let orgId: string;
  let buildingId: string;
  let ownerCookie: string;
  const ownerEmail = `fs-e2e-${Date.now()}@example.com`;
  const saved = { driver: process.env.STORAGE_DRIVER, root: process.env.STORAGE_FS_ROOT };

  beforeAll(async () => {
    fsRoot = mkdtempSync(path.join(tmpdir(), 'nodescope-e2e-fs-'));
    process.env.STORAGE_DRIVER = 'fs';
    process.env.STORAGE_FS_ROOT = fsRoot;

    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER_TOKEN).useValue(mockAdapter).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: ownerEmail, password: 'Password123!', name: 'FS E2E' });
    const c = res.headers['set-cookie'];
    ownerCookie = Array.isArray(c) ? c[0] : c;

    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const org = await prisma.organization.create({ data: { name: `FS E2E ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: ownerUser.id, organizationId: orgId, role: 'OWNER' } });
    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'Campus' } });
    const building = await prisma.property.create({ data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'HQ' } });
    buildingId = building.id;
  }, 60000);

  afterAll(async () => {
    if (orgId) {
      await prisma.buildingModelVersion.deleteMany({ where: { organizationId: orgId } });
      await prisma.buildingModel.deleteMany({ where: { organizationId: orgId } });
      await prisma.property.deleteMany({ where: { organizationId: orgId, type: 'BUILDING' } });
      await prisma.property.deleteMany({ where: { organizationId: orgId } });
      await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }
    await app?.close();
    if (saved.driver !== undefined) process.env.STORAGE_DRIVER = saved.driver; else delete process.env.STORAGE_DRIVER;
    if (saved.root !== undefined) process.env.STORAGE_FS_ROOT = saved.root; else delete process.env.STORAGE_FS_ROOT;
  });

  it('created the fs root on boot (ensureReady)', () => {
    expect(existsSync(fsRoot)).toBe(true);
  });

  it('an IFC upload → activate → download round-trips through the filesystem', async () => {
    const ifc = Buffer.from('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');
    const up = await request(app.getHttpServer())
      .post(`/api/v1/buildings/${buildingId}/model/versions?fileName=fs.ifc`)
      .set('Cookie', ownerCookie)
      .set('Content-Type', 'application/octet-stream')
      .send(ifc)
      .expect(201);
    const versionId = up.body.data.id as string;

    await request(app.getHttpServer())
      .put(`/api/v1/buildings/${buildingId}/model/active`)
      .set('Cookie', ownerCookie)
      .send({ versionId })
      .expect(200);

    // The blob now lives on disk under the fs root — prove it byte-for-byte via the API.
    const dl = await request(app.getHttpServer())
      .get(`/api/v1/buildings/${buildingId}/model/active/file`)
      .set('Cookie', ownerCookie)
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.setEncoding('latin1');
        r.on('data', (chunk: string) => (data += chunk));
        r.on('end', () => cb(null, data));
      })
      .expect(200);
    expect((dl.body as string).startsWith('ISO-10303-21')).toBe(true);

    // And the object physically exists on the filesystem (not S3), at the exact key
    // the DB recorded (the storage-key uuid is generated independently of the row id).
    const version = await prisma.buildingModelVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(version.storageKey.startsWith(`org/${orgId}/building/${buildingId}/`)).toBe(true);
    expect(existsSync(path.join(fsRoot, version.storageKey))).toBe(true);
  });
});
