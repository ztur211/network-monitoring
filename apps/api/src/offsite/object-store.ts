import type { Readable } from 'node:stream';
import {
  S3Client, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { OffsiteConfig } from './config';

export interface ObjectStore {
  put(key: string, body: Readable): Promise<void>;
  get(key: string): Promise<Readable>;
  list(prefix: string): Promise<string[]>;
  del(key: string): Promise<void>;
}

export class S3ObjectStore implements ObjectStore {
  constructor(private readonly s3: S3Client, private readonly bucket: string) {}

  async put(key: string, body: Readable): Promise<void> {
    await new Upload({
      client: this.s3,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: 'application/octet-stream' },
    }).done();
  }

  async get(key: string): Promise<Readable> {
    const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return out.Body as Readable;
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const out = await this.s3.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of out.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = out.NextContinuationToken;
    } while (token);
    return keys.sort();
  }

  async del(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function s3StoreFromConfig(cfg: OffsiteConfig): S3ObjectStore {
  const s3 = new S3Client({
    endpoint: cfg.s3.endpoint || undefined,
    region: cfg.s3.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.s3.accessKey, secretAccessKey: cfg.s3.secretKey },
  });
  return new S3ObjectStore(s3, cfg.s3.bucket);
}
