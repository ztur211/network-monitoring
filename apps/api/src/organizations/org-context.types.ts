import type { OrgRole } from '@prisma/client';

export interface OrgMemberContext {
  organizationId: string;
  role: OrgRole;
}

// The Express `Request.orgMember` augmentation (set by OrgContextGuard) lives in
// apps/api/src/types/express.d.ts alongside the user/session augmentation — a
// .d.ts file, where the ambient `namespace Express` merge is allowed by lint.
