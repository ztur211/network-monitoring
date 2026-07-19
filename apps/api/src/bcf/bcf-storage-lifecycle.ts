import { randomUUID } from 'node:crypto';

export interface StorageCleanup {
  deleteObject(key: string): Promise<void>;
}

export function uniqueSnapshotKey(organizationId: string, topicGuid: string, viewpointGuid: string): string {
  return `org/${organizationId}/bcf/${topicGuid}/${viewpointGuid}-${randomUUID()}.png`;
}

/**
 * Best-effort cleanup attempts every key; one backend error must not suppress the rest.
 * The callback is `async` so a *synchronous* throw from the backend becomes a rejected
 * promise that `allSettled` absorbs - a raw `.map(key => storage.deleteObject(key))`
 * would escape before `allSettled` ever sees it, and on the import error path that
 * would replace the real failure with a storage error.
 */
export async function cleanupStorageKeys(storage: StorageCleanup, keys: Iterable<string>): Promise<void> {
  await Promise.allSettled([...new Set(keys)].map(async (key) => storage.deleteObject(key)));
}
