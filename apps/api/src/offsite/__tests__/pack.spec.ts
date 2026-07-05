import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { packBundle, unpackBundle } from '../pack';

async function makeBundle(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'osb-src-'));
  await writeFile(join(dir, 'manifest.txt'), 'nodescope_version=1.2.3\n');
  await writeFile(join(dir, 'db.sql.gz'), Buffer.from('fake-db-dump'));
  await writeFile(join(dir, 'blobs.tar.gz'), Buffer.from('fake-blobs'));
  return dir;
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
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

  it('packBundle stream errors (not silently truncates) when tar -c fails', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'osb-bad-'));
    await writeFile(join(dir, 'manifest.txt'), 'x'); // db.sql.gz intentionally MISSING
    await expect(collect(packBundle(dir, false))).rejects.toThrow(); // consuming the stream fails loudly
  });

  it('unpackBundle rejects cleanly when tar -x fails (no unhandled rejection)', async () => {
    const src = await makeBundle(); // existing helper that builds a valid bundle dir
    await expect(unpackBundle(packBundle(src, false), '/nonexistent/deep/dir')).rejects.toThrow();
  });
});
