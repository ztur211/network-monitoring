import { EventEmitter } from 'node:events';
import type { Redis } from 'ioredis';
import { RealRedisService } from '../real-redis.service';

/**
 * RealRedisService wraps an ioredis client. The behaviour that matters here (the
 * ioredis command semantics are Redis's own, covered by the integration suite):
 *   1. it registers an 'error' listener so a connection blip never becomes an
 *      unhandled 'error' event that crashes the process (the boot-crash fix), and
 *   2. it delegates commands to the underlying client and reports itself enabled/real.
 */
function fakeClient() {
  const ee = new EventEmitter() as unknown as Redis & EventEmitter;
  Object.assign(ee, {
    get: jest.fn().mockResolvedValue('v'),
    set: jest.fn().mockResolvedValue('OK'),
    ping: jest.fn().mockResolvedValue('PONG'),
    pipeline: jest.fn().mockReturnValue({ exec: jest.fn() }),
    duplicate: jest.fn().mockReturnValue(Object.assign(new EventEmitter(), { id: 'dup' })),
    quit: jest.fn().mockResolvedValue('OK'),
  });
  return ee;
}

describe('RealRedisService', () => {
  it('reports itself enabled / real, carrying clusterMode', () => {
    const svc = new RealRedisService(fakeClient(), true);
    expect(svc.enabled).toBe(true);
    expect(svc.describe()).toEqual({ enabled: true, mode: 'real', clusterMode: true });
  });

  it('registers an error listener so a client error never goes unhandled (boot-crash fix)', () => {
    const client = fakeClient();
    new RealRedisService(client, false);
    expect(client.listenerCount('error')).toBeGreaterThan(0);
    // Emitting an error on an EventEmitter with no listener throws; with the
    // listener registered this must NOT throw.
    expect(() => client.emit('error', new Error('ECONNREFUSED'))).not.toThrow();
  });

  it('delegates commands to the underlying client', async () => {
    const client = fakeClient();
    const svc = new RealRedisService(client, false);
    expect(await svc.get('k')).toBe('v');
    expect(client.get).toHaveBeenCalledWith('k');
    expect(await svc.set('k', 'v', 'EX', 10, 'NX')).toBe('OK');
    expect(client.set).toHaveBeenCalledWith('k', 'v', 'EX', 10, 'NX');
    expect(await svc.ping()).toBe('PONG');
  });

  it('duplicate() returns a fresh client for the pub/sub adapter', () => {
    const client = fakeClient();
    const svc = new RealRedisService(client, false);
    const dup = svc.duplicate() as unknown as { id: string };
    expect(dup.id).toBe('dup');
    expect(client.duplicate).toHaveBeenCalled();
  });

  it('onModuleDestroy quits the client', async () => {
    const client = fakeClient();
    const svc = new RealRedisService(client, false);
    await svc.onModuleDestroy();
    expect(client.quit).toHaveBeenCalled();
  });
});
