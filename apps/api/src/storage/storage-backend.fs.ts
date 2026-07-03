import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { StorageBackend, resolveKeyPath } from './storage-backend';

/** Local-filesystem blob storage rooted at a directory. Single-node only. */
export class FsStorageBackend implements StorageBackend {
  constructor(private readonly root: string) {}

  async ensureReady(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async put(key: string, body: Readable, _contentType: string): Promise<void> {
    const dest = resolveKeyPath(this.root, key);
    await mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await pipeline(body, createWriteStream(tmp));
      await rename(tmp, dest); // atomic within a filesystem
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
  }

  async get(key: string): Promise<Readable> {
    const src = resolveKeyPath(this.root, key);
    await access(src); // throws ENOENT if missing, before returning a stream
    return createReadStream(src);
  }

  async delete(key: string): Promise<void> {
    await rm(resolveKeyPath(this.root, key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(resolveKeyPath(this.root, key));
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(abs);
        else out.push(path.relative(this.root, abs).split(path.sep).join('/'));
      }
    };
    try {
      await walk(this.root);
    } catch {
      /* root may not exist yet → empty */
    }
    return out;
  }
}
