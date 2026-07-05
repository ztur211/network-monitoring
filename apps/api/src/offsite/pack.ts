import { spawn } from 'node:child_process';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Tar the bundle's files (deterministic order) into a stream. The stream only
 *  ends cleanly if `tar -c` exits 0; a tar failure errors the stream. */
export function packBundle(bundleDir: string, includeBlobs: boolean): Readable {
  const files = ['manifest.txt', 'db.sql.gz'];
  if (includeBlobs) files.push('blobs.tar.gz');
  const child = spawn('tar', ['-c', '-C', bundleDir, ...files], { stdio: ['ignore', 'pipe', 'inherit'] });
  const out = new PassThrough();
  child.stdout.pipe(out, { end: false }); // we control end: only after a clean exit
  child.on('error', (e) => out.destroy(e));
  child.on('close', (code) => (code === 0 ? out.end() : out.destroy(new Error(`tar -c exited ${code ?? 'signal'}`))));
  return out;
}

/** Extract a tar stream into destDir (must exist). Rejects on any tar/pipe error. */
export async function unpackBundle(src: Readable, destDir: string): Promise<void> {
  const child = spawn('tar', ['-x', '-C', destDir], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar -x exited ${code ?? 'signal'}`))));
  });
  done.catch(() => {}); // if pipeline rejects first, keep `done`'s later rejection from going unhandled
  try {
    await pipeline(src, child.stdin);
  } catch (e) {
    // `tar -x` can finish extracting (it only needs the archive's end-of-data
    // marker) and close its stdin before our writer/upstream has formally
    // ended — a benign race, not data loss. `done` (tar -x's real exit code)
    // is authoritative; only re-throw genuine pipe/source errors here.
    if ((e as NodeJS.ErrnoException)?.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw e;
  }
  await done;
}
