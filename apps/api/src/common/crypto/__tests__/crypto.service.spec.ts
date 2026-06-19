import { CryptoService, CRYPTO_KEY } from '../crypto.service';
import { randomBytes } from 'node:crypto';

const svc = () => new CryptoService(randomBytes(32)); // 32-byte key

describe('CryptoService', () => {
  it('round-trips and uses a random IV (different ciphertext each call)', () => {
    const c = svc();
    const a = c.encrypt('community-string'); const b = c.encrypt('community-string');
    expect(a).not.toBe(b);
    expect(c.decrypt(a)).toBe('community-string');
  });
  it('rejects a tampered blob (GCM auth)', () => {
    const c = svc(); const blob = Buffer.from(c.encrypt('x'), 'base64'); blob[blob.length - 1] ^= 0xff;
    expect(() => c.decrypt(blob.toString('base64'))).toThrow();
  });
});
