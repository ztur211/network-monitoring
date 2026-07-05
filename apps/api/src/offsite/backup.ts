import { basename, join, dirname, resolve } from 'node:path';
import { mkdir, access, mkdtemp, rename, rm, readdir } from 'node:fs/promises';
import type { ObjectStore } from './object-store';
import type { OffsiteConfig } from './config';
import { sealStream, unsealStream } from './crypto';
import { packBundle, unpackBundle } from './pack';

const SUFFIX = '.nsob';
const keyFor = (cfg: OffsiteConfig, name: string) => `${cfg.prefix}/${name}${SUFFIX}`;

export async function pushBundle(store: ObjectStore, cfg: OffsiteConfig, bundleDir: string): Promise<string> {
  const name = basename(bundleDir);
  // fail closed: never upload a bundle that's missing its core files
  const required = ['manifest.txt', 'db.sql.gz', ...(cfg.includeBlobs ? ['blobs.tar.gz'] : [])];
  for (const f of required) {
    try { await access(join(bundleDir, f)); }
    catch { throw new Error(`offsite: bundle ${bundleDir} is missing ${f}`); }
  }
  const key = keyFor(cfg, name);
  const ciphertext = sealStream(cfg.pubkey, packBundle(bundleDir, cfg.includeBlobs));
  await store.put(key, ciphertext);
  await prune(store, cfg);
  return key;
}

/**
 * Extracts into a temp dir (sibling of destDir, same filesystem) and only
 * promotes into destDir once the whole ciphertext stream has verified.
 * Streaming AEAD yields plaintext bytes before it can detect truncation or a
 * late tamper, so extracting straight into destDir could leave a partial,
 * "restorable-looking" bundle behind on failure. On any failure destDir is
 * left with no partial files.
 */
export async function pullBundle(
  store: ObjectStore, cfg: OffsiteConfig, name: string, destDir: string, privateKeyB64: string,
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const tmp = await mkdtemp(join(dirname(resolve(destDir)), '.osb-pull-'));
  try {
    const ciphertext = await store.get(keyFor(cfg, name));
    // unseal throws on wrong-key/tamper/truncation; unpack extracts into tmp
    await unpackBundle(unsealStream(cfg.pubkey, privateKeyB64, ciphertext), tmp);
    // promote atomically (same fs): only reached if the whole stream verified
    for (const f of await readdir(tmp)) await rename(join(tmp, f), join(destDir, f));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export async function listBackups(store: ObjectStore, cfg: OffsiteConfig): Promise<string[]> {
  const keys = await store.list(`${cfg.prefix}/`);
  return keys
    .filter((k) => k.endsWith(SUFFIX))
    .map((k) => basename(k).slice(0, -SUFFIX.length))
    .sort();
}

async function prune(store: ObjectStore, cfg: OffsiteConfig): Promise<void> {
  const names = await listBackups(store, cfg);
  for (const name of names.slice(0, Math.max(0, names.length - cfg.keep))) {
    await store.del(keyFor(cfg, name));
  }
}
