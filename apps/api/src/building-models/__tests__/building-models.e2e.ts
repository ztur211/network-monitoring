import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E for /api/v1/buildings/:propertyId/model* — proxied IFC upload against real MinIO (:9100).
 * Requires the docker test stack (DB :5433, Redis :6380, MinIO :9100).
 */
const VALID_IFC = Buffer.from('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');

describe('BuildingModelsController (e2e, real MinIO)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let memberCookie: string;
  let prisma: PrismaService;
  let orgId: string;
  let siteId: string;
  let buildingId: string;
  let v1Id: string;
  const ownerEmail = `e2e-bm-owner-${Date.now()}@example.com`;
  const memberEmail = `e2e-bm-member-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const ownerSignUp = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: ownerEmail, password: 'Password123!', name: 'BM Owner' });
    const oc = ownerSignUp.headers['set-cookie'];
    ownerCookie = Array.isArray(oc) ? oc[0] : oc;

    const memberSignUp = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: memberEmail, password: 'Password123!', name: 'BM Member' });
    const mc = memberSignUp.headers['set-cookie'];
    memberCookie = Array.isArray(mc) ? mc[0] : mc;

    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const org = await prisma.organization.create({ data: { name: `E2E BM ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: ownerUser.id, organizationId: orgId, role: 'OWNER' } });
    await prisma.organizationMember.create({ data: { userId: memberUser.id, organizationId: orgId, role: 'MEMBER' } });

    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'HQ' } });
    siteId = site.id;
    const building = await prisma.property.create({ data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'Tower A' } });
    buildingId = building.id;
  });

  afterAll(async () => {
    await prisma.buildingModelVersion.deleteMany({ where: { organizationId: orgId } });
    await prisma.buildingModel.deleteMany({ where: { organizationId: orgId } });
    await prisma.property.deleteMany({ where: { organizationId: orgId, type: 'BUILDING' } });
    await prisma.property.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, memberEmail] } } });
    await app.close();
  });

  it('GET model is 404 MODEL_001 before any upload', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/buildings/${buildingId}/model`)
      .set('Cookie', ownerCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MODEL_001');
  });

  it('MEMBER upload is blocked with 403 ORG_003', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/buildings/${buildingId}/model/versions?fileName=x.ifc`)
      .set('Cookie', memberCookie)
      .set('Content-Type', 'application/octet-stream')
      .send(VALID_IFC);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORG_003');
  });

  it('OWNER upload of a non-IFC body is rejected 422 MODEL_007 (and leaves no model)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/buildings/${buildingId}/model/versions?fileName=garbage.ifc`)
      .set('Cookie', ownerCookie)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('this is not an ifc file at all'));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('MODEL_007');

    const after = await request(app.getHttpServer())
      .get(`/api/v1/buildings/${buildingId}/model`)
      .set('Cookie', ownerCookie);
    expect(after.status).toBe(404); // model created only after a successful upload
  });

  it('OWNER uploads a valid IFC → 201, version 1 becomes active; list + get reflect it', async () => {
    const up = await request(app.getHttpServer())
      .post(`/api/v1/buildings/${buildingId}/model/versions?fileName=test.ifc&units=METRE`)
      .set('Cookie', ownerCookie)
      .set('Content-Type', 'application/octet-stream')
      .send(VALID_IFC);
    expect(up.status).toBe(201);
    expect(up.body.data.versionNumber).toBe(1);
    expect(up.body.data.fileName).toBe('test.ifc');
    expect(up.body.data).not.toHaveProperty('storageKey');
    v1Id = up.body.data.id;

    const model = await request(app.getHttpServer())
      .get(`/api/v1/buildings/${buildingId}/model`)
      .set('Cookie', ownerCookie);
    expect(model.status).toBe(200);
    expect(model.body.data.activeVersionId).toBe(v1Id);

    const versions = await request(app.getHttpServer())
      .get(`/api/v1/buildings/${buildingId}/model/versions`)
      .set('Cookie', ownerCookie);
    expect(versions.status).toBe(200);
    expect(versions.body.data.map((v: { id: string }) => v.id)).toContain(v1Id);
  });

  it('downloads the active file with byte-identical content', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/buildings/${buildingId}/model/active/file`)
      .set('Cookie', ownerCookie)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, VALID_IFC)).toBe(0);
  });

  it('upload v2, rollback active to v1, delete non-active (204), delete active (409 MODEL_005)', async () => {
    const up2 = await request(app.getHttpServer())
      .post(`/api/v1/buildings/${buildingId}/model/versions?fileName=v2.ifc`)
      .set('Cookie', ownerCookie)
      .set('Content-Type', 'application/octet-stream')
      .send(VALID_IFC);
    expect(up2.status).toBe(201);
    expect(up2.body.data.versionNumber).toBe(2);
    const v2Id = up2.body.data.id;

    const roll = await request(app.getHttpServer())
      .put(`/api/v1/buildings/${buildingId}/model/active`)
      .set('Cookie', ownerCookie)
      .send({ versionId: v1Id });
    expect(roll.status).toBe(200);
    expect(roll.body.data.activeVersionId).toBe(v1Id);

    await request(app.getHttpServer())
      .delete(`/api/v1/buildings/${buildingId}/model/versions/${v2Id}`)
      .set('Cookie', ownerCookie)
      .expect(204);

    const delActive = await request(app.getHttpServer())
      .delete(`/api/v1/buildings/${buildingId}/model/versions/${v1Id}`)
      .set('Cookie', ownerCookie);
    expect(delActive.status).toBe(409);
    expect(delActive.body.error.code).toBe('MODEL_005');
  });
});
