import { S3Client } from '@aws-sdk/client-s3';
import type { storageConfig } from '../common/config/storage.config';
import { StorageBackend } from './storage-backend';
import { FsStorageBackend } from './storage-backend.fs';
import { S3StorageBackend } from './storage-backend.s3';

/** Selects the storage backend from config. One place; shared by module + seed + migration. */
export function createStorageBackend(config: ReturnType<typeof storageConfig>): StorageBackend {
  if (config.driver === 'fs') return new FsStorageBackend(config.fsRoot);
  const s3 = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return new S3StorageBackend(s3, config.bucket);
}
