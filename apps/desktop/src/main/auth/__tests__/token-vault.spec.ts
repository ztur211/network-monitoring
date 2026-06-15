import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, Buffer>();

vi.mock('electron', () => ({
  safeStorage: {
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ''),
    isEncryptionAvailable: () => true,
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
  beforeEach(() => store.clear());

  it('saves encrypted and loads back; clear() removes it', async () => {
    const vault = new TokenVault('/tmp/auth.bin');
    expect(await vault.load()).toBeNull();
    await vault.save('TKN');
    expect(store.get('/tmp/auth.bin')!.toString().startsWith('enc:')).toBe(true);
    expect(await vault.load()).toBe('TKN');
    await vault.clear();
    expect(await vault.load()).toBeNull();
  });
});
