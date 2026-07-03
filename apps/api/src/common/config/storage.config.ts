import path from 'node:path';

/**
 * Object-storage config. `driver` selects the backend: `s3` (default; S3/MinIO)
 * or `fs` (local filesystem, single-node appliance). `forcePathStyle` is required
 * for MinIO. `fsRoot` is used only in fs mode.
 */
export const storageConfig = () => ({
  driver: (process.env.STORAGE_DRIVER ?? 's3') as 's3' | 'fs',
  fsRoot: process.env.STORAGE_FS_ROOT ?? path.resolve(process.cwd(), 'var/storage'),
  endpoint: process.env.STORAGE_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.STORAGE_REGION ?? 'us-east-1',
  bucket: process.env.STORAGE_BUCKET ?? 'nodescope',
  accessKeyId: process.env.STORAGE_ACCESS_KEY ?? 'minioadmin',
  secretAccessKey: process.env.STORAGE_SECRET_KEY ?? 'minioadmin',
  forcePathStyle: true,
});
