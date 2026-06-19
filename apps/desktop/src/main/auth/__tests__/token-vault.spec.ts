import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store = new Map<string, Buffer>();
let encAvailable = true;

vi.mock('electron', () => ({
  safeStorage: {
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ''),
    isEncryptionAvailable: () => encAvailable,
  },
}));

vi.mock('node:fs', () => ({
  promises: {
    writeFile: async (p: string, b: Buffer) => { store.set(p, b); },
    readFile: async (p: string) => {
      const b = store.get(p);
      if (!b) throw new Error('ENOENT');
      return b;
    },
    rm: async (p: string) => { store.delete(p); },
  },
}));

import { TokenVault } from '../token-vault';

describe('TokenVault', () => {
  beforeEach(() => {
    store.clear();
    encAvailable = true;
  });

  afterEach(() => {
    encAvailable = true;
  });

  it('saves encrypted and loads back; clear() removes it', async () => {
    const vault = new TokenVault('/tmp/auth.bin');
    expect(await vault.load()).toBeNull();
    await vault.save('TKN');
    expect(store.get('/tmp/auth.bin')!.toString().startsWith('enc:')).toBe(true);
    expect(await vault.load()).toBe('TKN');
    await vault.clear();
    expect(await vault.load()).toBeNull();
  });

  it('throws VAULT_ENCRYPTION_UNAVAILABLE and writes nothing when OS encryption is unavailable', async () => {
    encAvailable = false;
    const vault = new TokenVault('/tmp/auth.bin');
    await expect(vault.save('TKN')).rejects.toThrow('VAULT_ENCRYPTION_UNAVAILABLE');
    expect(store.has('/tmp/auth.bin')).toBe(false);
  });
});
