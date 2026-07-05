import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packBundle, unpackBundle } from '../pack';

async function makeBundle(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'osb-src-'));
  await writeFile(join(dir, 'manifest.txt'), 'nodescope_version=1.2.3\n');
  await writeFile(join(dir, 'db.sql.gz'), Buffer.from('fake-db-dump'));
  await writeFile(join(dir, 'blobs.tar.gz'), Buffer.from('fake-blobs'));
  return dir;
}

describe('offsite pack', () => {
  it('pack→unpack round-trips all files with blobs', async () => {
    const src = await makeBundle();
    const dest = await mkdtemp(join(tmpdir(), 'osb-dst-'));
    await unpackBundle(packBundle(src, true), dest);
    expect((await readdir(dest)).sort()).toEqual(['blobs.tar.gz', 'db.sql.gz', 'manifest.txt']);
    expect((await readFile(join(dest, 'db.sql.gz'))).toString()).toBe('fake-db-dump');
    expect((await readFile(join(dest, 'manifest.txt'))).toString()).toContain('1.2.3');
  });

  it('omits blobs when includeBlobs=false', async () => {
    const src = await makeBundle();
    const dest = await mkdtemp(join(tmpdir(), 'osb-dst2-'));
    await unpackBundle(packBundle(src, false), dest);
    expect((await readdir(dest)).sort()).toEqual(['db.sql.gz', 'manifest.txt']);
  });
});
