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
});
