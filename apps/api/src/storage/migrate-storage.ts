import { S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { StorageBackend } from './storage-backend';
import { FsStorageBackend } from './storage-backend.fs';
import { S3StorageBackend } from './storage-backend.s3';

function sizeOf(stream: Readable): Promise<number> {
  return new Promise((resolve, reject) => {
    let n = 0;
    stream.on('data', (c: Buffer) => (n += c.length));
    stream.on('end', () => resolve(n));
    stream.on('error', reject);
  });
}

/** Copy every source key to dest; skip keys already present at matching size. Pure over backends. */
export async function migrateStorage(opts: {
  source: StorageBackend;
  dest: StorageBackend;
  dryRun: boolean;
}): Promise<{ copied: number; skipped: number; failed: number }> {
  const { source, dest, dryRun } = opts;
  const keys = await source.list();
  let copied = 0, skipped = 0, failed = 0;
  for (const key of keys) {
    try {
      const srcSize = await sizeOf(await source.get(key));
      if (await dest.exists(key)) {
        const dstSize = await sizeOf(await dest.get(key));
        if (dstSize === srcSize) { skipped++; continue; }
      }
      if (!dryRun) {
        await dest.put(key, await source.get(key), 'application/octet-stream');
        // Verify the written size — a copy that landed truncated (torn stream,
        // full disk) must count as failed, not silently pass.
        const written = await sizeOf(await dest.get(key));
        if (written !== srcSize) {
          failed++;
          continue;
        }
      }
      copied++;
    } catch {
      failed++;
    }
  }
  return { copied, skipped, failed };
}

export function makeBackend(kind: 's3' | 'fs'): StorageBackend {
  if (kind === 'fs') {
    const root = process.env.STORAGE_FS_ROOT;
    if (!root) throw new Error('STORAGE_FS_ROOT must be set for fs');
    return new FsStorageBackend(root);
  }
  const s3 = new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY ?? 'minioadmin',
      secretAccessKey: process.env.STORAGE_SECRET_KEY ?? 'minioadmin',
    },
  });
  return new S3StorageBackend(s3, process.env.STORAGE_BUCKET ?? 'nodescope');
}

// CLI: `node dist/storage/migrate-storage.js --from s3 --to fs [--dry-run]`
// The api builds to CommonJS, so this runs when invoked directly. Guarded with
// `typeof require` so importing the module under the ESM jest runtime (where `require`
// is undefined) does not throw — the unit test imports `migrateStorage` in that env.
if (typeof require !== 'undefined' && require.main === module) {
  const args = process.argv.slice(2);
  const from = args[args.indexOf('--from') + 1] as 's3' | 'fs';
  const to = args[args.indexOf('--to') + 1] as 's3' | 'fs';
  const dryRun = args.includes('--dry-run');
  if (!['s3', 'fs'].includes(from) || !['s3', 'fs'].includes(to)) {
    console.error('usage: migrate-storage --from s3|fs --to s3|fs [--dry-run]');
    process.exit(1);
  }
  void (async () => {
    const source = makeBackend(from);
    const dest = makeBackend(to);
    await dest.ensureReady();
    const r = await migrateStorage({ source, dest, dryRun });
    console.log(`${dryRun ? '[dry-run] ' : ''}copied=${r.copied} skipped=${r.skipped} failed=${r.failed}`);
    process.exit(r.failed ? 1 : 0);
  })();
}
