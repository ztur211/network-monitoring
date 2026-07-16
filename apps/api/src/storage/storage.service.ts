import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import { Readable } from 'node:stream';
import { StorageBackend } from './storage-backend';

export const STORAGE_BACKEND = Symbol('STORAGE_BACKEND');

/**
 * The single seam consumers use for object storage. Keeps the pure key builder and
 * delegates blob operations to the configured backend (S3 or filesystem).
 */
@Injectable()
export class StorageService implements OnModuleDestroy {
  constructor(@Inject(STORAGE_BACKEND) private readonly backend: StorageBackend) {}

  buildVersionKey(organizationId: string, propertyId: string, versionId: string): string {
    return `org/${organizationId}/building/${propertyId}/${versionId}.ifc`;
  }

  ensureBucket(): Promise<void> {
    return this.backend.ensureReady();
  }

  putObjectStream(key: string, body: Readable, contentType = 'application/octet-stream'): Promise<void> {
    return this.backend.put(key, body, contentType);
  }

  getObjectStream(key: string): Promise<Readable> {
    return this.backend.get(key);
  }

  deleteObject(key: string): Promise<void> {
    return this.backend.delete(key);
  }

  objectExists(key: string): Promise<boolean> {
    return this.backend.exists(key);
  }

  async onModuleDestroy(): Promise<void> {
    await this.backend.close();
  }
}
