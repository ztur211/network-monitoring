import { PrismaClient, DeviceCategory, ConnectionType } from '@prisma/client';
import { auth } from '../src/auth/better-auth.config';

const prisma = new PrismaClient();

async function main() {
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error('SEED_PASSWORD env var is required');

  const existingUser = await prisma.user.findUnique({ where: { email: 'dev@nodescope.io' } });
  if (existingUser) {
    console.log('Seed user already exists — skipping user creation, seeding devices...');
    await seedDevices(existingUser.id);
    return;
  }

  const signUpResult = await auth.api.signUpEmail({
    body: { email: 'dev@nodescope.io', password, name: 'Dev User' },
  });

  const userId = signUpResult.user.id;
  await seedDevices(userId);
  console.log('Seed complete: dev@nodescope.io created with sample network');
}

async function seedDevices(userId: string) {
  const existing = await prisma.device.count({ where: { userId } });
  if (existing > 0) {
    console.log('Devices already seeded — skipping');
    return;
  }

  const [router, switch1, ap, server, firewall] = await Promise.all([
    prisma.device.create({
      data: {
        userId,
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
        userId,
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
        userId,
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
        userId,
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
        userId,
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
        userId,
        sourceDeviceId: router.id,
        targetDeviceId: switch1.id,
        connectionType: ConnectionType.ETHERNET,
        notes: 'Uplink from router to core switch',
      },
    }),
    prisma.deviceConnection.create({
      data: {
        userId,
        sourceDeviceId: switch1.id,
        targetDeviceId: server.id,
        connectionType: ConnectionType.ETHERNET,
      },
    }),
  ]);

  await prisma.fiberRun.create({
    data: {
      userId,
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
      userId,
      ispName: 'Comcast Business',
      circuitId: 'CX-123456789',
      serviceType: 'Fiber',
      bandwidth: 1000,
      deviceId: router.id,
      notes: '1 Gbps symmetric fiber circuit',
    },
  });

  console.log('Seeded: 5 devices, 2 connections, 1 fiber run, 1 circuit');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
