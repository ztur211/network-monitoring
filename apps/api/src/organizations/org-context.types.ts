import type { OrgRole } from '@prisma/client';

export interface OrgMemberContext {
  organizationId: string;
  role: OrgRole;
}

// Augments the Express Request type to carry the resolved org-member context
// after OrgContextGuard runs. Uses the same global-namespace merge pattern as
// apps/api/src/types/express.d.ts (which adds user/session) so TypeScript
// merges both augmentations without conflict.
declare global {
  namespace Express {
    interface Request {
      orgMember?: OrgMemberContext | null;
    }
  }
}
