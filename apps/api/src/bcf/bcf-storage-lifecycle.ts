import { randomUUID } from 'node:crypto';

export interface StorageCleanup {
  deleteObject(key: string): Promise<void>;
}

export function uniqueSnapshotKey(organizationId: string, topicGuid: string, viewpointGuid: string): string {
  return `org/${organizationId}/bcf/${topicGuid}/${viewpointGuid}-${randomUUID()}.png`;
}

/** Best-effort cleanup attempts every key; one backend error must not suppress the rest. */
export async function cleanupStorageKeys(storage: StorageCleanup, keys: Iterable<string>): Promise<void> {
  await Promise.allSettled([...new Set(keys)].map((key) => storage.deleteObject(key)));
}
