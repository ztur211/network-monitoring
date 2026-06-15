import { Injectable, Inject } from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { storageConfig } from '../common/config/storage.config';

export const S3_CLIENT = Symbol('S3_CLIENT');

/**
 * The single abstraction over S3-compatible object storage (MinIO). The only code
 * that talks to the bucket — Spec 1 §10.2. Upload/download stream (no whole-file
 * buffering); the bucket is private and reached only through this seam.
 */
@Injectable()
export class StorageService {
  private readonly bucket = storageConfig().bucket;

  constructor(@Inject(S3_CLIENT) private readonly s3: S3Client) {}

  buildVersionKey(organizationId: string, propertyId: string, versionId: string): string {
    return `org/${organizationId}/building/${propertyId}/${versionId}.ifc`;
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (e: unknown) {
      const name = (e as { name?: string })?.name;
      if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw e;
    }
  }

  async putObjectStream(
    key: string,
    body: Readable,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    await new Upload({
      client: this.s3,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
    }).done();
  }

  async getObjectStream(key: string): Promise<Readable> {
    const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return out.Body as Readable;
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}
