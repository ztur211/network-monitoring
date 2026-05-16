import { Module } from '@nestjs/common';
import { DataSourcesModule } from '../data-sources/data-sources.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [DataSourcesModule],
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
