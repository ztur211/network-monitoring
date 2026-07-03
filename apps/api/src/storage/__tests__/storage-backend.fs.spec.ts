import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { FsStorageBackend } from '../storage-backend.fs';

async function drain(s: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

describe('FsStorageBackend', () => {
  let root: string;
  let fs: FsStorageBackend;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'nodescope-fs-'));
    fs = new FsStorageBackend(root);
    await fs.ensureReady();
  });

  it('put then get round-trips the bytes', async () => {
    await fs.put('org/o1/building/b1/v1.ifc', Readable.from(Buffer.from('hello')), 'application/octet-stream');
    expect((await drain(await fs.get('org/o1/building/b1/v1.ifc'))).toString()).toBe('hello');
  });

  it('put leaves no .tmp file behind at the key path (atomic)', async () => {
    await fs.put('a/b.bin', Readable.from(Buffer.from('x')), 'application/octet-stream');
    expect(existsSync(path.join(root, 'a/b.bin'))).toBe(true);
    expect(readdirSync(path.join(root, 'a')).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('get rejects with ENOENT for a missing key', async () => {
    await expect(fs.get('nope/x.bin')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('delete is idempotent (missing key is ok)', async () => {
    await expect(fs.delete('nope/x.bin')).resolves.toBeUndefined();
    await fs.put('k.bin', Readable.from(Buffer.from('x')), 'application/octet-stream');
    await fs.delete('k.bin');
    expect(await fs.exists('k.bin')).toBe(false);
  });

  it('exists reflects presence', async () => {
    expect(await fs.exists('k.bin')).toBe(false);
    await fs.put('k.bin', Readable.from(Buffer.from('x')), 'application/octet-stream');
    expect(await fs.exists('k.bin')).toBe(true);
  });

  it('list returns forward-slash keys relative to root', async () => {
    await fs.put('org/o1/a.ifc', Readable.from(Buffer.from('1')), 'application/octet-stream');
    await fs.put('org/o1/bcf/t/s.png', Readable.from(Buffer.from('2')), 'image/png');
    expect((await fs.list()).sort()).toEqual(['org/o1/a.ifc', 'org/o1/bcf/t/s.png']);
  });

  it('rejects an unsafe key', async () => {
    await expect(fs.put('../escape', Readable.from(Buffer.from('x')), 'x')).rejects.toThrow('INVALID_STORAGE_KEY');
  });
});
