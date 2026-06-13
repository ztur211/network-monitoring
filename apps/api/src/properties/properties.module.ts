import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { PropertiesRepository } from './properties.repository';
import { PropertiesService } from './properties.service';
import { PropertiesController } from './properties.controller';

@Module({
  imports: [PrismaModule, OrganizationsModule, ConflictResolutionModule],
  controllers: [PropertiesController],
  providers: [PropertiesRepository, PropertiesService],
  exports: [PropertiesRepository, PropertiesService],
})
export class PropertiesModule {}
