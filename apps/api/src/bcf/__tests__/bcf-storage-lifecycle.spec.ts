import { cleanupStorageKeys, uniqueSnapshotKey } from '../bcf-storage-lifecycle';

describe('BCF storage lifecycle helpers', () => {
  it('builds a unique snapshot key for rollback-safe replacement uploads', () => {
    const first = uniqueSnapshotKey('org', 'topic', 'view');
    const second = uniqueSnapshotKey('org', 'topic', 'view');
    expect(first).toMatch(/^org\/org\/bcf\/topic\/view-[0-9a-f-]+\.png$/);
    expect(second).not.toBe(first);
  });

  it('attempts cleanup for every uploaded key even if one deletion fails', async () => {
    const storage = {
      deleteObject: jest.fn()
        .mockRejectedValueOnce(new Error('temporary failure'))
        .mockResolvedValueOnce(undefined),
    };
    await cleanupStorageKeys(storage, ['one', 'two']);
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
  });

  it('absorbs a synchronous throw so the import error path is not masked', async () => {
    // The import failure path runs cleanup and then rethrows the ORIGINAL error. A backend
    // that throws synchronously (rather than rejecting) used to escape Promise.allSettled
    // and replace that error with a storage error, hiding the real cause of the failure.
    const storage = {
      deleteObject: jest.fn(() => {
        throw new Error('synchronous backend failure');
      }),
    };
    await expect(cleanupStorageKeys(storage, ['one', 'two'])).resolves.toBeUndefined();
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
  });
});
