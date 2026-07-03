import { createStorageBackend } from '../storage-backend.factory';
import { FsStorageBackend } from '../storage-backend.fs';
import { S3StorageBackend } from '../storage-backend.s3';

const base = {
  endpoint: 'http://localhost:9000', region: 'us-east-1', bucket: 'nodescope',
  accessKeyId: 'a', secretAccessKey: 'b', forcePathStyle: true, fsRoot: '/tmp/x',
};

describe('createStorageBackend', () => {
  it('returns FsStorageBackend when driver=fs', () => {
    expect(createStorageBackend({ ...base, driver: 'fs' })).toBeInstanceOf(FsStorageBackend);
  });
  it('returns S3StorageBackend when driver=s3', () => {
    expect(createStorageBackend({ ...base, driver: 's3' })).toBeInstanceOf(S3StorageBackend);
  });
});
