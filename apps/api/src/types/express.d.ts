import { AuthenticatedUser } from '@nodescope/shared';
import type { OrgMemberContext } from '../organizations/org-context.types';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      orgMember?: OrgMemberContext | null;
      session?: {
        id: string;
        userId: string;
        token: string;
        expiresAt: Date;
        ipAddress?: string | null;
        userAgent?: string | null;
        createdAt: Date;
        updatedAt: Date;
      };
    }
  }
}
