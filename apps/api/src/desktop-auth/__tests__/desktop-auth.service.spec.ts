import { Test } from '@nestjs/testing';
import { createHash, randomBytes } from 'node:crypto';
import { DesktopAuthService } from '../desktop-auth.service';
import { RedisService } from '../../redis/redis.service';

const base64url = (b: Buffer) => b.toString('base64url');
const challengeFor = (verifier: string) => base64url(createHash('sha256').update(verifier).digest());

describe('DesktopAuthService', () => {
  let service: DesktopAuthService;
  const store = new Map<string, string>();
  const redis = {
    set: jest.fn((k, v, ..._a) => { store.set(k, v); return Promise.resolve('OK'); }),
    get: jest.fn((k) => Promise.resolve(store.get(k) ?? null)),
    del: jest.fn((k) => { store.delete(k); return Promise.resolve(1); }),
  } as any;

  beforeEach(async () => {
    store.clear(); jest.clearAllMocks();
    const ref = await Test.createTestingModule({
      providers: [DesktopAuthService, { provide: RedisService, useValue: redis }],
    }).compile();
    service = ref.get(DesktopAuthService);
  });

  it('issues a one-time code and exchanges it only with the matching verifier', async () => {
    const verifier = base64url(randomBytes(32));
    const code = await service.issueCode({ sessionToken: 'SESS', challenge: challengeFor(verifier) });
    expect(await service.exchange(code, verifier)).toBe('SESS');
    await expect(service.exchange(code, verifier)).rejects.toMatchObject({ code: 'DAUTH_002' }); // one-time: gone
  });

  it('rejects a bad verifier (DAUTH_003) and burns the one-time code even on that failure', async () => {
    const code = await service.issueCode({ sessionToken: 'SESS', challenge: challengeFor('right') });
    await expect(service.exchange(code, 'wrong')).rejects.toMatchObject({ code: 'DAUTH_003' });
    // del-before-verify: the failed attempt consumed the code, so even the correct verifier now fails closed
    await expect(service.exchange(code, 'right')).rejects.toMatchObject({ code: 'DAUTH_002' });
  });
});
