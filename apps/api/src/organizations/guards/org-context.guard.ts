import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { OrganizationsRepository } from '../organizations.repository';

@Injectable()
export class OrgContextGuard implements CanActivate {
  constructor(private readonly repo: OrganizationsRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;
    if (!userId) {
      request.orgMember = null;
      return true;
    }
    const member = await this.repo.findMemberByUserId(userId);
    request.orgMember = member
      ? { id: member.id, organizationId: member.organizationId, role: member.role }
      : null;
    return true;
  }
}
