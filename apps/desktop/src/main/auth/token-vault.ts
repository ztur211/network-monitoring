import { safeStorage } from 'electron';
import { promises as fs } from 'node:fs';

export class TokenVault {
  constructor(private readonly file: string) {}

  async save(token: string): Promise<void> {
    await fs.writeFile(this.file, safeStorage.encryptString(token));
  }

  async load(): Promise<string | null> {
    try {
      return safeStorage.decryptString(await fs.readFile(this.file));
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    await fs.rm(this.file, { force: true });
  }
}
