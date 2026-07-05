import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Tar the bundle's files (deterministic order) into a stream. */
export function packBundle(bundleDir: string, includeBlobs: boolean): Readable {
  const files = ['manifest.txt', 'db.sql.gz'];
  if (includeBlobs) files.push('blobs.tar.gz');
  const child = spawn('tar', ['-c', '-C', bundleDir, ...files], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.on('error', (e) => child.stdout.destroy(e));
  return child.stdout;
}

/** Extract a tar stream into destDir (created if missing). */
export async function unpackBundle(src: Readable, destDir: string): Promise<void> {
  const child = spawn('tar', ['-x', '-C', destDir], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar -x exited ${code}`))));
  });
  await pipeline(src, child.stdin);
  await done;
}
