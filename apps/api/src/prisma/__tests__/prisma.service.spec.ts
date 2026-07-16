import { PrismaService, prisma } from '../prisma.service';

describe('Prisma lifecycle', () => {
  it('disconnects both the injected and Better Auth clients during module destruction', async () => {
    const service = new PrismaService();
    const injectedDisconnect = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined);
    const authDisconnect = jest.spyOn(prisma, '$disconnect').mockResolvedValue(undefined);

    await service.onModuleDestroy();

    expect(injectedDisconnect).toHaveBeenCalledTimes(1);
    expect(authDisconnect).toHaveBeenCalledTimes(1);
  });
});
