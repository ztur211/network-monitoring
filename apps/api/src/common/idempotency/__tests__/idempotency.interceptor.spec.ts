import { lastValueFrom, of } from 'rxjs';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { IdempotencyInterceptor } from '../idempotency.interceptor';

const mockRedis = { get: jest.fn(), set: jest.fn() };

function context(headers: Record<string, string>, user?: { id: string }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (h: string) => headers[h.toLowerCase()],
        user,
      }),
    }),
  } as unknown as ExecutionContext;
}

const IDEM_TTL = 24 * 60 * 60;

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;

  beforeEach(() => {
    interceptor = new IdempotencyInterceptor(mockRedis as never);
    jest.clearAllMocks();
  });

  it('passes through (no Redis touch) when the Idempotency-Key header is absent', async () => {
    const next: CallHandler = { handle: jest.fn(() => of({ data: 'fresh' })) };

    const result = await lastValueFrom(
      await interceptor.intercept(context({}, { id: 'u1' }), next),
    );

    expect(result).toEqual({ data: 'fresh' });
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  it('passes through when the request is unauthenticated (no user)', async () => {
    const next: CallHandler = { handle: jest.fn(() => of({ data: 'fresh' })) };

    await lastValueFrom(await interceptor.intercept(context({ 'idempotency-key': 'k' }), next));

    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  it('returns the cached response on a key hit and never calls the handler', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify({ data: 'cached' }));
    const next: CallHandler = { handle: jest.fn() };

    const result = await lastValueFrom(
      await interceptor.intercept(context({ 'idempotency-key': 'k1' }, { id: 'u1' }), next),
    );

    expect(result).toEqual({ data: 'cached' });
    expect(next.handle).not.toHaveBeenCalled();
    expect(mockRedis.get).toHaveBeenCalledWith('idempotency:u1:k1');
  });

  it('runs the handler and caches the response (user-scoped key) on a key miss', async () => {
    mockRedis.get.mockResolvedValue(null);
    const next: CallHandler = { handle: jest.fn(() => of({ data: 'fresh' })) };

    const result = await lastValueFrom(
      await interceptor.intercept(context({ 'idempotency-key': 'k2' }, { id: 'u1' }), next),
    );

    expect(result).toEqual({ data: 'fresh' });
    expect(mockRedis.set).toHaveBeenCalledWith(
      'idempotency:u1:k2',
      JSON.stringify({ data: 'fresh' }),
      'EX',
      IDEM_TTL,
    );
  });
});
