import { NetworkContextRepository } from '../network-context.repository';

/**
 * Query-shape test for the AI network-context reads. Prisma is fully mocked, so
 * this needs no database (it lives in the integration suite only because of the
 * `.repository.spec.ts` filename convention). The point it protects: every
 * findMany must be BOUNDED (`take`) and DETERMINISTICALLY ORDERED so a large
 * org's whole network can never be loaded into one system prompt.
 */
describe('NetworkContextRepository (query caps)', () => {
  const findMany = () => jest.fn().mockResolvedValue([]);

  function build() {
    const prisma = {
      device: { findMany: findMany() },
      deviceConnection: { findMany: findMany() },
      fiberRun: { findMany: findMany() },
      circuit: { findMany: findMany() },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = new NetworkContextRepository(prisma as any);
    return { prisma, repo };
  }

  it('caps and orders every entity query (OWNER — no scope filter)', async () => {
    const { prisma, repo } = build();

    await repo.getNetworkEntities('org-1', null);

    expect(prisma.device.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200, orderBy: { createdAt: 'desc' } }),
    );
    expect(prisma.deviceConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200, orderBy: { createdAt: 'desc' } }),
    );
    expect(prisma.fiberRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100, orderBy: { createdAt: 'desc' } }),
    );
    expect(prisma.circuit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100, orderBy: { createdAt: 'desc' } }),
    );
  });

  it('still caps every query when a property scope filter is applied', async () => {
    const { prisma, repo } = build();

    await repo.getNetworkEntities('org-1', ['prop-a', 'prop-b']);

    for (const model of [prisma.device, prisma.deviceConnection, prisma.fiberRun, prisma.circuit]) {
      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: expect.any(Number) }),
      );
      const takeArg = model.findMany.mock.calls[0][0].take;
      expect(takeArg).toBeGreaterThan(0);
    }
  });
});
