import { Readable } from 'node:stream';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeypair } from '../crypto';
import type { ObjectStore } from '../object-store';
import type { OffsiteConfig } from '../config';
import { pushBundle, pullBundle, listBackups } from '../backup';

jest.setTimeout(20_000);

class MemStore implements ObjectStore {
  objs = new Map<string, Buffer>();
  async put(key: string, body: Readable) {
    const chunks: Buffer[] = [];
    for await (const c of body) chunks.push(Buffer.from(c));
    this.objs.set(key, Buffer.concat(chunks));
  }
  async get(key: string) {
    const v = this.objs.get(key);
    if (!v) throw new Error(`no such key ${key}`);
    return Readable.from(v);
  }
  async list(prefix: string) { return [...this.objs.keys()].filter((k) => k.startsWith(prefix)).sort(); }
  async del(key: string) { this.objs.delete(key); }
}

async function bundle(name: string): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'osb-'));
  const dir = join(base, name);
  await mkdir(dir);
  await writeFile(join(dir, 'manifest.txt'), `nodescope_version=9.9.9\n`);
  await writeFile(join(dir, 'db.sql.gz'), Buffer.from(`db-${name}`));
  await writeFile(join(dir, 'blobs.tar.gz'), Buffer.from(`blobs-${name}`));
  return dir;
}

async function bigBundle(name: string): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'osb-big-'));
  const dir = join(base, name);
  await mkdir(dir);
  await writeFile(join(dir, 'manifest.txt'), 'nodescope_version=9.9.9\n');
  await writeFile(join(dir, 'db.sql.gz'), Buffer.alloc(400_000, 0xab)); // spans many secretstream frames
  await writeFile(join(dir, 'blobs.tar.gz'), Buffer.alloc(400_000, 0xcd));
  return dir;
}

function cfg(over: Partial<OffsiteConfig> = {}): OffsiteConfig {
  return {
    pubkey: '', prefix: 'nodescope', keep: 7, includeBlobs: true,
    s3: { endpoint: '', region: 'auto', bucket: 'b', accessKey: '', secretKey: '' }, ...over,
  };
}

describe('offsite push/pull/list', () => {
  it('push → list → pull recovers the exact bundle (encrypted in transit)', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const store = new MemStore();
    const dir = await bundle('nodescope-20260101-000000');
    const key = await pushBundle(store, cfg({ pubkey: publicKey }), dir);
    expect(key).toBe('nodescope/nodescope-20260101-000000.nsob');
    // stored object is ciphertext, not the plaintext db bytes
    expect(store.objs.get(key)!.subarray(0, 5).toString()).toBe('NSOB1');
    expect(store.objs.get(key)!.includes(Buffer.from('db-nodescope-20260101-000000'))).toBe(false);
    expect(await listBackups(store, cfg({ pubkey: publicKey }))).toEqual(['nodescope-20260101-000000']);

    const dest = await mkdtemp(join(tmpdir(), 'osb-restore-'));
    await pullBundle(store, cfg({ pubkey: publicKey }), 'nodescope-20260101-000000', dest, privateKey);
    expect((await readdir(dest)).sort()).toEqual(['blobs.tar.gz', 'db.sql.gz', 'manifest.txt']);
    expect((await readFile(join(dest, 'db.sql.gz'))).toString()).toBe('db-nodescope-20260101-000000');
  });

  it('includeBlobs=false omits blobs; wrong key fails the pull', async () => {
    const good = await generateKeypair();
    const bad = await generateKeypair();
    const store = new MemStore();
    const dir = await bundle('nodescope-20260102-000000');
    await pushBundle(store, cfg({ pubkey: good.publicKey, includeBlobs: false }), dir);
    const dest = await mkdtemp(join(tmpdir(), 'osb-r2-'));
    await pullBundle(store, cfg({ pubkey: good.publicKey }), 'nodescope-20260102-000000', dest, good.privateKey);
    expect((await readdir(dest)).sort()).toEqual(['db.sql.gz', 'manifest.txt']);
    const dest2 = await mkdtemp(join(tmpdir(), 'osb-r3-'));
    await expect(
      pullBundle(store, cfg({ pubkey: bad.publicKey }), 'nodescope-20260102-000000', dest2, bad.privateKey),
    ).rejects.toThrow();
  });

  it('prunes to keep', async () => {
    const { publicKey } = await generateKeypair();
    const store = new MemStore();
    const c = cfg({ pubkey: publicKey, keep: 2 });
    for (const ts of ['20260101', '20260102', '20260103']) {
      await pushBundle(store, c, await bundle(`nodescope-${ts}-000000`));
    }
    expect(await listBackups(store, c)).toEqual(['nodescope-20260102-000000', 'nodescope-20260103-000000']);
  });

  it('leaves destDir empty when the pull fails (temp-dir promote)', async () => {
    const good = await generateKeypair(); const bad = await generateKeypair();
    const store = new MemStore();
    await pushBundle(store, cfg({ pubkey: good.publicKey }), await bundle('nodescope-20260109-000000'));
    const dest = await mkdtemp(join(tmpdir(), 'osb-fail-'));
    await expect(
      pullBundle(store, cfg({ pubkey: bad.publicKey }), 'nodescope-20260109-000000', dest, bad.privateKey),
    ).rejects.toThrow();
    expect(await readdir(dest)).toEqual([]); // no partial bundle
  });

  it('leaves destDir EMPTY when a correct-key pull fails mid-stream (proves temp-dir promote)', async () => {
    const kp = await generateKeypair();
    const store = new MemStore();
    const key = await pushBundle(store, cfg({ pubkey: kp.publicKey }), await bigBundle('nodescope-20260110-000000'));
    const obj = store.objs.get(key)!;
    // corrupt a byte deep in the middle → a late data frame's AEAD fails AFTER earlier
    // frames have decrypted+extracted (a naive extract-into-destDir would leave partial files).
    obj[Math.floor(obj.length / 2)] ^= 0xff;
    const dest = await mkdtemp(join(tmpdir(), 'osb-corrupt-'));
    await expect(
      pullBundle(store, cfg({ pubkey: kp.publicKey }), 'nodescope-20260110-000000', dest, kp.privateKey),
    ).rejects.toThrow();
    expect(await readdir(dest)).toEqual([]); // no partial bundle promoted
  });
});
