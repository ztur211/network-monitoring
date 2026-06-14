/**
 * Scoped realtime fan-out e2e — verifies that emitScoped sends device events
 * only to sockets whose effectiveRoots overlap the event's governing site.
 *
 * Topology:
 *   org
 *   ├── sA  (team-A covers sA; MEMBER-A is in team-A → scoped to sA)
 *   └── sB  (team-B covers sB; MEMBER-B is in team-B → scoped to sB)
 *   └── OWNER (unscoped — sees everything)
 *
 * Mutation: OWNER PATCHes a device under sA.
 * Expected:
 *   - OWNER socket   → receives v1:device:updated
 *   - MEMBER-A socket → receives v1:device:updated  (sA ⊆ scope)
 *   - MEMBER-B socket → does NOT receive it          (sB scope ≠ sA ancestry)
 *
 * Strategy: run the full AppModule (real test DB + Redis), connect three
 * socket.io clients using session cookies obtained from the sign-in endpoint,
 * PATCH the device via HTTP, then collect events over a short window.
 * The Redis adapter is the local in-memory adapter during tests (no real
 * multi-node pub/sub), so fetchSockets() returns all sockets in this process.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { WS_EVENTS } from '@nodescope/shared';

const WAIT_MS = 600; // time to collect events after the PATCH

function cookieToHeader(raw: string): string {
  // pick only the cookie name=value part (strip path/httponly/etc.)
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

describe('RealtimeGateway — scoped fan-out (e2e)', () => {
  let app: INestApplication;
  let port: number;

  let ownerCookie: string;
  let memberACookie: string;
  let memberBCookie: string;

  let orgId: string;
  let sAId: string;
  let sBId: string;
  let networkId: string;
  let deviceAId: string;
  let deviceAVersion: number;

  const ts = Date.now();
  const ownerEmail = `e2e-scope-owner-${ts}@example.com`;
  const memberAEmail = `e2e-scope-ma-${ts}@example.com`;
  const memberBEmail = `e2e-scope-mb-${ts}@example.com`;

  let ownerSocket: ClientSocket | null = null;
  let memberASocket: ClientSocket | null = null;
  let memberBSocket: ClientSocket | null = null;

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

    // ── sign up / sign in three users ──────────────────────────────────────
    ownerCookie = pickSetCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: ownerEmail, password: 'Password123!', name: 'Scope Owner' }),
    );
    memberACookie = pickSetCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: memberAEmail, password: 'Password123!', name: 'Scope MemberA' }),
    );
    memberBCookie = pickSetCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: memberBEmail, password: 'Password123!', name: 'Scope MemberB' }),
    );

    // ── seed org + sites + teams + memberships + device ────────────────────
    const prisma = app.get(PrismaService);
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const memberAUser = await prisma.user.findUniqueOrThrow({ where: { email: memberAEmail } });
    const memberBUser = await prisma.user.findUniqueOrThrow({ where: { email: memberBEmail } });

    const org = await prisma.organization.create({ data: { name: `ScopeTestOrg-${ts}` } });
    orgId = org.id;

    await prisma.organizationMember.create({ data: { userId: ownerUser.id, organizationId: orgId, role: 'OWNER' } });
    const maMembership = await prisma.organizationMember.create({ data: { userId: memberAUser.id, organizationId: orgId, role: 'MEMBER' } });
    const mbMembership = await prisma.organizationMember.create({ data: { userId: memberBUser.id, organizationId: orgId, role: 'MEMBER' } });

    // Sites
    const sA = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `sA-${ts}` } });
    const sB = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `sB-${ts}` } });
    sAId = sA.id;
    sBId = sB.id;

    // Network chartered to both sites
    const network = await prisma.network.create({ data: { organizationId: orgId, userId: ownerUser.id, name: `Net-${ts}` } });
    networkId = network.id;
    await prisma.networkProperty.create({ data: { organizationId: orgId, networkId, propertyId: sAId } });
    await prisma.networkProperty.create({ data: { organizationId: orgId, networkId, propertyId: sBId } });

    // Team-A → sA → MEMBER-A
    const teamA = await prisma.team.create({ data: { organizationId: orgId, name: `TeamA-${ts}`, creatorMemberId: null } });
    await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: teamA.id, propertyId: sAId } });
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: teamA.id, memberId: maMembership.id } });

    // Team-B → sB → MEMBER-B
    const teamB = await prisma.team.create({ data: { organizationId: orgId, name: `TeamB-${ts}`, creatorMemberId: null } });
    await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: teamB.id, propertyId: sBId } });
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: teamB.id, memberId: mbMembership.id } });

    // Device under sA
    const deviceA = await prisma.device.create({
      data: { organizationId: orgId, userId: ownerUser.id, networkId, propertyId: sAId, name: `DevA-${ts}`, category: 'SWITCH' },
    });
    deviceAId = deviceA.id;
    deviceAVersion = deviceA.version;
  });

  afterAll(async () => {
    ownerSocket?.disconnect();
    memberASocket?.disconnect();
    memberBSocket?.disconnect();

    const prisma = app.get(PrismaService);
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, memberAEmail, memberBEmail] } } });
    await app.close();
  });

  it('MEMBER-A (scoped sA) receives DEVICE_UPDATED; MEMBER-B (scoped sB) does NOT; OWNER always does', async () => {
    const wsUrl = `http://localhost:${port}`;
    ownerSocket   = await connectSocket(wsUrl, ownerCookie);
    memberASocket = await connectSocket(wsUrl, memberACookie);
    memberBSocket = await connectSocket(wsUrl, memberBCookie);

    const ownerEvents: unknown[]   = [];
    const memberAEvents: unknown[] = [];
    const memberBEvents: unknown[] = [];

    ownerSocket.on(WS_EVENTS.DEVICE_UPDATED,   (p) => ownerEvents.push(p));
    memberASocket.on(WS_EVENTS.DEVICE_UPDATED, (p) => memberAEvents.push(p));
    memberBSocket.on(WS_EVENTS.DEVICE_UPDATED, (p) => memberBEvents.push(p));

    // Wait briefly so sockets are fully registered in the org: room on the server
    await new Promise((r) => setTimeout(r, 200));

    // OWNER PATCHes the device under sA
    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/devices/${deviceAId}`)
      .set('Cookie', ownerCookie)
      .send({ baseVersion: deviceAVersion, changes: [{ field: 'notes', oldValue: null, newValue: 'scoped-test' }] });

    expect(patchRes.status).toBe(200);

    // Collect events
    await new Promise((r) => setTimeout(r, WAIT_MS));

    // OWNER: unscoped → must receive the event
    expect(ownerEvents).toHaveLength(1);
    expect(ownerEvents[0]).toMatchObject({ deviceId: deviceAId });

    // MEMBER-A: scoped to sA (which is the governing site) → must receive
    expect(memberAEvents).toHaveLength(1);
    expect(memberAEvents[0]).toMatchObject({ deviceId: deviceAId });

    // MEMBER-B: scoped to sB only → must NOT receive the sA event
    expect(memberBEvents).toHaveLength(0);
  });
});
