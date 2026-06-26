import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PropertyTreeModule } from '../property-tree/property-tree.module';
import { PermissionsController } from './permissions.controller';
import { TeamsController } from './teams.controller';
import { MemberAssignmentsController } from './member-assignments.controller';
import { PermissionsService } from './permissions.service';
import { PermissionsRepository } from './permissions.repository';

@Module({
  imports: [PrismaModule, PropertyTreeModule],
  controllers: [PermissionsController, TeamsController, MemberAssignmentsController],
  providers: [PermissionsService, PermissionsRepository],
  exports: [PermissionsService, PermissionsRepository],
})
export class PermissionsModule {}
