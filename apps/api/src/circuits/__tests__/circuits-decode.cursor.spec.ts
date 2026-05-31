// reflect-metadata is needed because CircuitsRepository is an @Injectable class
// and this spec does not import @nestjs/core (which would pull it in).
import 'reflect-metadata';
import { HttpStatus } from '@nestjs/common';
import { CircuitsRepository } from '../circuits.repository';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';

// A malformed `?cursor=` (only @IsString()-validated on the way in) must surface
// as a 400, not crash JSON.parse into a 500. The decode happens before any
// Prisma call, so this needs no DB — a stub PrismaService is enough.
describe('CircuitsRepository cursor decode guard', () => {
  let repo: CircuitsRepository;
  let findMany: jest.Mock;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    const prisma = { circuit: { findMany } } as unknown as PrismaService;
    repo = new CircuitsRepository(prisma);
  });

  // NodeScopeException carries a 400; read it defensively so the test doesn't
  // couple to whether it exposes getStatus() (HttpException-derived) or a plain
  // status field.
  const statusOf = (e: unknown): number | undefined => {
    const obj = e as {
      getStatus?: () => number;
      status?: number;
      statusCode?: number;
      httpStatus?: number;
    };
    if (typeof obj.getStatus === 'function') return obj.getStatus();
    return obj.status ?? obj.statusCode ?? obj.httpStatus;
  };

  const expectBadRequest = async (cursor: string): Promise<void> => {
    expect.assertions(3);
    try {
      await repo.findWithCursor('user-1', 20, cursor);
    } catch (err) {
      expect(err).toBeInstanceOf(NodeScopeException);
      expect(statusOf(err)).toBe(HttpStatus.BAD_REQUEST);
      expect(findMany).not.toHaveBeenCalled();
    }
  };

  it('throws a 400 for a non-base64 / non-JSON cursor instead of a 500', async () => {
    await expectBadRequest('!!!not-base64!!!');
  });

  it('throws a 400 for base64 that decodes to invalid JSON', async () => {
    const garbageJson = Buffer.from('this is not json', 'utf-8').toString('base64');
    await expectBadRequest(garbageJson);
  });

  it('does not throw and queries normally for a well-formed cursor', async () => {
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: new Date().toISOString(), id: 'abc' }),
      'utf-8',
    ).toString('base64');

    await expect(repo.findWithCursor('user-1', 20, cursor)).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
