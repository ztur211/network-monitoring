import { PrismaClient, DeviceCategory, ConnectionType, PropertyType } from '@prisma/client';
import { auth } from '../src/auth/better-auth.config';

const prisma = new PrismaClient();

async function main() {
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error('SEED_PASSWORD env var is required');

  // ── Organization & Domains ────────────────────────────────────────────────
  let org = await prisma.organization.findFirst({ where: { name: 'Acme Networks' } });
  if (!org) {
    org = await prisma.organization.create({ data: { name: 'Acme Networks' } });
    await prisma.organizationDomain.create({
      data: { organizationId: org.id, domain: 'acme.test', verified: true },
    });
    console.log('Created organization: Acme Networks');
  } else {
    console.log('Organization already exists — skipping org creation');
  }

  // ── Super-admin ───────────────────────────────────────────────────────────
  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@nodescope.test' },
    update: { isSuperAdmin: true },
    create: {
      email: 'admin@nodescope.test',
      emailVerified: true,
      name: 'Platform Admin',
      isSuperAdmin: true,
    },
  });
  console.log('Super-admin ready:', superAdmin.email);

  // ── Owner (org-scoped dev user) ───────────────────────────────────────────
  let ownerId: string;
  const existingOwner = await prisma.user.findUnique({ where: { email: 'owner@acme.test' } });
  if (existingOwner) {
    ownerId = existingOwner.id;
    console.log('Owner already exists — skipping sign-up');
  } else {
    const signUpResult = await auth.api.signUpEmail({
      body: { email: 'owner@acme.test', password, name: 'Acme Owner' },
    });
    ownerId = signUpResult.user.id;
    console.log('Created owner user: owner@acme.test');
  }

  // ── Org membership ────────────────────────────────────────────────────────
  const existingMember = await prisma.organizationMember.findUnique({
    where: { userId: ownerId },
  });
  if (!existingMember) {
    await prisma.organizationMember.create({
      data: { userId: ownerId, organizationId: org.id, role: 'OWNER' },
    });
    console.log('Linked owner to Acme Networks as OWNER');
  }

  // ── Sample network data ───────────────────────────────────────────────────
  await seedNetworkData(org.id, ownerId);
}

async function seedNetworkData(organizationId: string, creatorUserId: string) {
  const existing = await prisma.device.count({ where: { organizationId } });
  if (existing > 0) {
    console.log('Devices already seeded — skipping');
    return;
  }

  // ── Property tree: SITE → BUILDING → FLOOR ───────────────────────────────
  const site = await prisma.property.create({
    data: {
      organizationId,
      name: 'Acme HQ',
      type: PropertyType.SITE,
    },
  });

  const building = await prisma.property.create({
    data: {
      organizationId,
      name: 'Main Building',
      type: PropertyType.BUILDING,
      parentId: site.id,
    },
  });

  const floor1 = await prisma.property.create({
    data: {
      organizationId,
      name: 'Ground Floor',
      type: PropertyType.FLOOR,
      parentId: building.id,
    },
  });

  const floor2 = await prisma.property.create({
    data: {
      organizationId,
      name: 'Server Room',
      type: PropertyType.FLOOR,
      parentId: building.id,
    },
  });

  console.log('Created property tree: HQ Site → Main Building → Ground Floor / Server Room');

  // ── Network ───────────────────────────────────────────────────────────────
  const network = await prisma.network.create({
    data: {
      organizationId,
      userId: creatorUserId,
      name: 'Acme Corporate LAN',
      homeAddress: '123 Corporate Blvd, New York, NY',
    },
  });

  // ── Charter: network → HQ SITE ───────────────────────────────────────────
  await prisma.networkProperty.create({
    data: {
      organizationId,
      networkId: network.id,
      propertyId: site.id,
    },
  });

  console.log('Chartered network to HQ site');

  // ── Devices (placed under charter) ───────────────────────────────────────
  const [router, switch1, ap, server, firewall] = await Promise.all([
    prisma.device.create({
      data: {
        organizationId,
        userId: creatorUserId,
        networkId: network.id,
        propertyId: floor1.id,
        roleCode: 'CORE_ROUTER',
        name: 'Core Router',
        category: DeviceCategory.ROUTER,
        latitude: 40.7128,
        longitude: -74.006,
        ipAddress: '192.168.1.1',
        notes: 'Main gateway router',
      },
    }),
    prisma.device.create({
      data: {
        organizationId,
        userId: creatorUserId,
        networkId: network.id,
        propertyId: floor1.id,
        name: 'Core Switch',
        category: DeviceCategory.SWITCH,
        latitude: 40.7129,
        longitude: -74.0061,
        floor: 1,
        floorLabel: 'Ground Floor',
        ipAddress: '192.168.1.2',
      },
    }),
    prisma.device.create({
      data: {
        organizationId,
        userId: creatorUserId,
        networkId: network.id,
        propertyId: floor1.id,
        name: 'Office AP',
        category: DeviceCategory.ACCESS_POINT,
        latitude: 40.713,
        longitude: -74.0062,
        floor: 1,
        floorLabel: 'Ground Floor',
        ipAddress: '192.168.1.10',
      },
    }),
    prisma.device.create({
      data: {
        organizationId,
        userId: creatorUserId,
        networkId: network.id,
        propertyId: floor2.id,
        roleCode: 'PRIMARY_STORAGE',
        name: 'File Server',
        category: DeviceCategory.SERVER_RACK,
        latitude: 40.7131,
        longitude: -74.0063,
        floor: 2,
        floorLabel: 'Server Room',
        ipAddress: '192.168.1.20',
      },
    }),
    prisma.device.create({
      data: {
        organizationId,
        userId: creatorUserId,
        networkId: network.id,
        propertyId: floor1.id,
        name: 'Firewall',
        category: DeviceCategory.FIREWALL,
        latitude: 40.7127,
        longitude: -74.0059,
        ipAddress: '192.168.1.254',
      },
    }),
  ]);

  await Promise.all([
    prisma.deviceConnection.create({
      data: {
        organizationId,
        userId: creatorUserId,
        sourceDeviceId: router.id,
        targetDeviceId: switch1.id,
        connectionType: ConnectionType.ETHERNET,
        notes: 'Uplink from router to core switch',
      },
    }),
    prisma.deviceConnection.create({
      data: {
        organizationId,
        userId: creatorUserId,
        sourceDeviceId: switch1.id,
        targetDeviceId: server.id,
        connectionType: ConnectionType.ETHERNET,
      },
    }),
  ]);

  await prisma.fiberRun.create({
    data: {
      organizationId,
      userId: creatorUserId,
      name: 'MDF to IDF Run',
      startDeviceId: router.id,
      endDeviceId: server.id,
      cableType: 'OS2 Singlemode',
      lengthMeters: 45.5,
      notes: 'Runs through conduit in east wall',
    },
  });

  await prisma.circuit.create({
    data: {
      organizationId,
      userId: creatorUserId,
      ispName: 'Comcast Business',
      circuitId: 'CX-123456789',
      serviceType: 'Fiber',
      bandwidth: 1000,
      deviceId: router.id,
      notes: '1 Gbps symmetric fiber circuit',
    },
  });

  // Suppress unused-variable TypeScript warnings for intentionally created vars
  void ap;
  void firewall;

  console.log('Seeded: site tree, 1 network, charter, 5 devices, 2 connections, 1 fiber run, 1 circuit for org:', organizationId);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
