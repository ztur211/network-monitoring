import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { AdminOrganizationsController } from './admin-organizations.controller';
import { OrgContextGuard } from './guards/org-context.guard';
import { OrgRoleGuard } from './guards/org-role.guard';
import { SuperAdminGuard } from './guards/super-admin.guard';

@Module({
  // forwardRef breaks the OrganizationsModule → ConflictResolutionModule →
  // RealtimeModule → OrganizationsModule circular dependency.
  imports: [PrismaModule, UsersModule, forwardRef(() => ConflictResolutionModule)],
  controllers: [OrganizationsController, AdminOrganizationsController],
  providers: [OrganizationsRepository, OrganizationsService, OrgContextGuard, OrgRoleGuard, SuperAdminGuard],
  exports: [OrganizationsRepository],
})
export class OrganizationsModule {}
