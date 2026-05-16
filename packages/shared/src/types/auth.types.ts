// SessionUser is populated by Better Auth's $Infer.Session at the API layer.
// The frontend uses this shape from auth.store — it is kept in sync with
// the Better Auth user model (tier, homeLatitude, homeLongitude added as
// additionalFields in better-auth.config.ts).

export interface SessionUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  image: string | null;
  tier: string;
  homeLatitude: number | null;
  homeLongitude: number | null;
  createdAt: string;
  updatedAt: string;
}

export type AuthenticatedUser = SessionUser;
