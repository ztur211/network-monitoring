import { Injectable, Inject } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const CRYPTO_KEY = Symbol('CRYPTO_KEY');

@Injectable()
export class CryptoService {
  constructor(@Inject(CRYPTO_KEY) private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('SECRET_ENCRYPTION_KEY must be 32 bytes');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    // layout: iv(12) | authTag(16) | ciphertext
    return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
  }

  decrypt(blob: string): string {
    const b = Buffer.from(blob, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
    decipher.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString('utf8');
  }
}
