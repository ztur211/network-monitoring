import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { AdminOrganizationsController } from './admin-organizations.controller';
import { InvitationsRepository } from './invitations.repository';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { InvitationAcceptController } from './invitation-accept.controller';
import { JoinRequestsRepository } from './join-requests.repository';
import { JoinRequestsService } from './join-requests.service';
import { JoinRequestsController } from './join-requests.controller';
import { JoinRequestSubmitController } from './join-request-submit.controller';
import { MembersController } from './members.controller';
import { OrgContextGuard } from './guards/org-context.guard';
import { OrgRoleGuard } from './guards/org-role.guard';
import { SuperAdminGuard } from './guards/super-admin.guard';

@Module({
  // forwardRef breaks the OrganizationsModule → ConflictResolutionModule →
  // RealtimeModule → OrganizationsModule circular dependency.
  imports: [PrismaModule, UsersModule, forwardRef(() => ConflictResolutionModule)],
  controllers: [OrganizationsController, AdminOrganizationsController, InvitationsController, InvitationAcceptController, JoinRequestsController, JoinRequestSubmitController, MembersController],
  providers: [OrganizationsRepository, OrganizationsService, InvitationsRepository, InvitationsService, JoinRequestsRepository, JoinRequestsService, OrgContextGuard, OrgRoleGuard, SuperAdminGuard],
  exports: [OrganizationsRepository, OrgRoleGuard],
})
export class OrganizationsModule {}
