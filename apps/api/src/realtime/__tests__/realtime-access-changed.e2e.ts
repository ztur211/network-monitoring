/**
 * Access-changed notification e2e — verifies that the gateway fires
 * `v1:access:changed` on a MEMBER's socket when the OWNER grants them a site.
 *
 * Topology:
 *   org
 *   ├── sB  (not yet assigned to the MEMBER)
 *   └── OWNER  (unscoped)
 *   └── MEMBER (starts with no site assignments)
 *
 * Action: OWNER calls POST /api/v1/members/:memberId/properties granting the MEMBER sB.
 * Expected: MEMBER's socket receives `v1:access:changed` with { organizationId }.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { WS_EVENTS } from '@nodescope/shared';

const WAIT_MS = 600;

function cookieToHeader(raw: string): string {
  return raw.split(';')[0];
}

function pickSetCookie(res: request.Response): string {
  const c = res.headers['set-cookie'];
  return Array.isArray(c) ? c[0] : (c as unknown as string);
}

async function connectSocket(url: string, cookie: string): Promise<ClientSocket> {
  return new Promise<ClientSocket>((resolve, reject) => {
    const client = io(url, {
      withCredentials: true,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { cookie: cookieToHeader(cookie) },
    });
    const timeout = setTimeout(() => {
      client.disconnect();
      reject(new Error('Socket connect timeout'));
    }, 10000);
    client.on('connect', () => {
      clearTimeout(timeout);
      resolve(client);
    });
    client.on('connect_error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

describe('RealtimeGateway — v1:access:changed on site grant (e2e)', () => {
  let app: INestApplication;
  let port: number;

  let ownerCookie: string;
  let memberCookie: string;

  let orgId: string;
  let memberMemberId: string;
  let sBId: string;

  const ts = Date.now();
  const ownerEmail = `e2e-ac-owner-${ts}@example.com`;
  const memberEmail = `e2e-ac-member-${ts}@example.com`;

  let memberSocket: ClientSocket | null = null;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    const httpServer = app.getHttpServer() as import('http').Server;
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as { port: number }).port;

    // Sign up two users
    ownerCookie = pickSetCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: ownerEmail, password: 'Password123!', name: 'AC Owner' }),
    );
    memberCookie = pickSetCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: memberEmail, password: 'Password123!', name: 'AC Member' }),
    );

    // Seed org + site + memberships
    const prisma = app.get(PrismaService);
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });

    const org = await prisma.organization.create({ data: { name: `ACTestOrg-${ts}` } });
    orgId = org.id;

    await prisma.organizationMember.create({ data: { userId: ownerUser.id, organizationId: orgId, role: 'OWNER' } });
    const memberMembership = await prisma.organizationMember.create({
      data: { userId: memberUser.id, organizationId: orgId, role: 'MEMBER' },
    });
    memberMemberId = memberMembership.id;

    // Site sB — not yet granted to member
    const sB = await prisma.property.create({
      data: { organizationId: orgId, parentId: null, type: 'SITE', name: `sB-${ts}` },
    });
    sBId = sB.id;
  });

  afterAll(async () => {
    memberSocket?.disconnect();

    const prisma = app.get(PrismaService);
    await prisma.memberProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.property.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, memberEmail] } } });
    await app.close();
  });

  it('MEMBER socket receives v1:access:changed when OWNER grants them a site', async () => {
    const wsUrl = `http://localhost:${port}`;
    memberSocket = await connectSocket(wsUrl, memberCookie);

    const accessChangedEvents: unknown[] = [];
    memberSocket.on(WS_EVENTS.ACCESS_CHANGED, (p) => accessChangedEvents.push(p));

    // Wait briefly so socket is registered in org: room on the server
    await new Promise((r) => setTimeout(r, 200));

    // OWNER grants sB to the MEMBER via HTTP
    const grantRes = await request(app.getHttpServer())
      .post(`/api/v1/members/${memberMemberId}/properties`)
      .set('Cookie', ownerCookie)
      .send({ propertyId: sBId });

    expect(grantRes.status).toBe(201);

    // Collect events
    await new Promise((r) => setTimeout(r, WAIT_MS));

    expect(accessChangedEvents).toHaveLength(1);
    expect(accessChangedEvents[0]).toMatchObject({ organizationId: orgId });
  });
});
