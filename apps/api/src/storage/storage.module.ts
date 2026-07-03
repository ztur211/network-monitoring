import { Module, OnModuleInit } from '@nestjs/common';
import { storageConfig } from '../common/config/storage.config';
import { StorageService, STORAGE_BACKEND } from './storage.service';
import { createStorageBackend } from './storage-backend.factory';

@Module({
  providers: [
    StorageService,
    { provide: STORAGE_BACKEND, useFactory: () => createStorageBackend(storageConfig()) },
  ],
  exports: [StorageService],
})
export class StorageModule implements OnModuleInit {
  constructor(private readonly storage: StorageService) {}

  async onModuleInit(): Promise<void> {
    await this.storage.ensureBucket(); // delegates to backend.ensureReady()
  }
}
