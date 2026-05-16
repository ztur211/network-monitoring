import { AuthenticatedUser } from '@nodescope/shared';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
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
