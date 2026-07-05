export interface OffsiteConfig {
  pubkey: string;
  prefix: string;
  keep: number;
  includeBlobs: boolean;
  s3: { endpoint: string; region: string; bucket: string; accessKey: string; secretKey: string };
}

export function offsiteConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OffsiteConfig | null {
  const pubkey = env.OFFSITE_BACKUP_PUBKEY ?? '';
  const bucket = env.OFFSITE_S3_BUCKET ?? '';
  if (!pubkey || !bucket) return null; // off-site disabled
  const keep = Number.parseInt(env.OFFSITE_KEEP ?? '', 10);
  return {
    pubkey,
    prefix: env.OFFSITE_S3_PREFIX ?? 'nodescope',
    keep: Number.isInteger(keep) && keep >= 1 ? keep : 7,
    includeBlobs: (env.OFFSITE_INCLUDE_BLOBS ?? 'true') !== 'false',
    s3: {
      endpoint: env.OFFSITE_S3_ENDPOINT ?? '',
      region: env.OFFSITE_S3_REGION ?? 'auto',
      bucket,
      accessKey: env.OFFSITE_S3_ACCESS_KEY ?? '',
      secretKey: env.OFFSITE_S3_SECRET_KEY ?? '',
    },
  };
}
