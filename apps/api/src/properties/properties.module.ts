import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { PropertiesRepository } from './properties.repository';
import { PropertiesService } from './properties.service';
import { PropertiesController } from './properties.controller';
import { NetworkPropertyRepository } from './network-property.repository';
import { NetworkPropertyService } from './network-property.service';
import { NetworkPropertyController } from './network-property.controller';
import { ContainmentService } from './containment.service';

@Module({
  imports: [PrismaModule, OrganizationsModule, ConflictResolutionModule],
  controllers: [PropertiesController, NetworkPropertyController],
  providers: [
    PropertiesRepository,
    PropertiesService,
    NetworkPropertyRepository,
    NetworkPropertyService,
    ContainmentService,
  ],
  exports: [PropertiesRepository, PropertiesService, ContainmentService, NetworkPropertyRepository],
})
export class PropertiesModule {}
