import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { FsStorageBackend } from '../storage-backend.fs';
import { migrateStorage } from '../migrate-storage';

describe('migrateStorage (fs → fs)', () => {
  it('copies missing keys, skips ones already present at matching size, respects dry-run', async () => {
    const src = new FsStorageBackend(mkdtempSync(path.join(tmpdir(), 'src-')));
    const dst = new FsStorageBackend(mkdtempSync(path.join(tmpdir(), 'dst-')));
    await src.ensureReady(); await dst.ensureReady();
    await src.put('org/a.ifc', Readable.from(Buffer.from('hello')), 'x');
    await src.put('org/b.png', Readable.from(Buffer.from('world!')), 'x');
    await dst.put('org/a.ifc', Readable.from(Buffer.from('hello')), 'x'); // already present, same size

    const dry = await migrateStorage({ source: src, dest: dst, dryRun: true });
    expect(dry).toEqual({ copied: 1, skipped: 1, failed: 0 });
    expect(await dst.exists('org/b.png')).toBe(false); // dry-run wrote nothing

    const run = await migrateStorage({ source: src, dest: dst, dryRun: false });
    expect(run).toEqual({ copied: 1, skipped: 1, failed: 0 });
    expect(await dst.exists('org/b.png')).toBe(true);
  });

  it('counts a truncated write as failed (post-copy size verification)', async () => {
    const src = new FsStorageBackend(mkdtempSync(path.join(tmpdir(), 'src-')));
    const real = new FsStorageBackend(mkdtempSync(path.join(tmpdir(), 'dst-')));
    await src.ensureReady();
    await real.ensureReady();
    await src.put('org/torn.bin', Readable.from(Buffer.from('full content')), 'x');

    // A dest whose put lands truncated bytes — as a torn stream or full disk would.
    const truncating = {
      ...real,
      ensureReady: real.ensureReady.bind(real),
      get: real.get.bind(real),
      delete: real.delete.bind(real),
      exists: real.exists.bind(real),
      list: real.list.bind(real),
      close: real.close.bind(real),
      put: (key: string, _body: Readable, ct: string) =>
        real.put(key, Readable.from(Buffer.from('full')), ct),
    };

    const run = await migrateStorage({ source: src, dest: truncating, dryRun: false });
    expect(run).toEqual({ copied: 0, skipped: 0, failed: 1 });
  });
});
