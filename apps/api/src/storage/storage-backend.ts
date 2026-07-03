import path from 'node:path';
import type { Readable } from 'node:stream';

/** The blob operations behind StorageService. Implemented by S3 + FS backends. */
export interface StorageBackend {
  /** Idempotent: S3 creates the bucket; FS makes the root dir. */
  ensureReady(): Promise<void>;
  put(key: string, body: Readable, contentType: string): Promise<void>;
  /** Rejects if the key is absent (parity with S3). */
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Every stored key, forward-slash form (migration only). */
  list(): Promise<string[]>;
}

/**
 * Map a storage key to an absolute filesystem path under `root`, rejecting any key
 * that could escape the root. Keys are server-generated, but never trust input.
 */
export function resolveKeyPath(root: string, key: string): string {
  if (key.includes('\0') || path.isAbsolute(key)) throw new Error('INVALID_STORAGE_KEY');
  const segments = key.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error('INVALID_STORAGE_KEY');
  }
  const resolved = path.resolve(root, ...segments);
  const rootWithSep = path.resolve(root) + path.sep;
  if (!resolved.startsWith(rootWithSep)) throw new Error('INVALID_STORAGE_KEY');
  return resolved;
}
