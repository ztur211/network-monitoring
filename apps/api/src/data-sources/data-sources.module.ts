import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DataSourcesRepository } from './data-sources.repository';
import { DataSourcesService } from './data-sources.service';

@Module({
  imports: [PrismaModule],
  providers: [DataSourcesRepository, DataSourcesService],
  exports: [DataSourcesService],
})
export class DataSourcesModule {}
