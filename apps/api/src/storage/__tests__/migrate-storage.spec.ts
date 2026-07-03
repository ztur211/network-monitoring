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
});
