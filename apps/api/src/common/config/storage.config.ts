/**
 * S3-compatible object-storage config (MinIO in dev/test). Read from process.env
 * with dev defaults — same convention as the other config helpers (e.g.
 * trust-proxy.config.ts). `forcePathStyle` is required for MinIO.
 */
export const storageConfig = () => ({
  endpoint: process.env.STORAGE_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.STORAGE_REGION ?? 'us-east-1',
  bucket: process.env.STORAGE_BUCKET ?? 'nodescope',
  accessKeyId: process.env.STORAGE_ACCESS_KEY ?? 'minioadmin',
  secretAccessKey: process.env.STORAGE_SECRET_KEY ?? 'minioadmin',
  forcePathStyle: true,
});
