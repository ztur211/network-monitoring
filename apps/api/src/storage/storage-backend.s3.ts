import type { Readable } from 'node:stream';
import {
  S3Client,
  CreateBucketCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { StorageBackend } from './storage-backend';

/** S3-compatible (MinIO) blob storage. The multi-node / cloud backend. */
export class S3StorageBackend implements StorageBackend {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async ensureReady(): Promise<void> {
    try {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (e: unknown) {
      const name = (e as { name?: string })?.name;
      if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw e;
    }
  }

  async put(key: string, body: Readable, contentType: string): Promise<void> {
    await new Upload({
      client: this.s3,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
    }).done();
  }

  async get(key: string): Promise<Readable> {
    const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return out.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const out = await this.s3.send(
        new ListObjectsV2Command({ Bucket: this.bucket, ContinuationToken: token }),
      );
      for (const o of out.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }
}
