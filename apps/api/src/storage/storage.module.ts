import { Module, OnModuleInit } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { storageConfig } from '../common/config/storage.config';
import { StorageService, S3_CLIENT } from './storage.service';

@Module({
  providers: [
    StorageService,
    {
      provide: S3_CLIENT,
      useFactory: () => {
        const c = storageConfig();
        return new S3Client({
          endpoint: c.endpoint,
          region: c.region,
          forcePathStyle: c.forcePathStyle,
          credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
        });
      },
    },
  ],
  exports: [StorageService],
})
export class StorageModule implements OnModuleInit {
  constructor(private readonly storage: StorageService) {}

  async onModuleInit(): Promise<void> {
    await this.storage.ensureBucket();
  }
}
