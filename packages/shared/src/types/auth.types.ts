// SessionUser is populated by Better Auth's $Infer.Session at the API layer.
// The frontend uses this shape from auth.store — it is kept in sync with
// the Better Auth user model (tier, homeLatitude, homeLongitude added as
// additionalFields in better-auth.config.ts).
//
// createdAt/updatedAt are typed as Date to match the Better Auth client
// SDK's inferred return type from authClient.getSession(). The wire format
// is ISO 8601 strings; Better Auth's client deserializes them into Date
// objects before they reach app code.

export interface SessionUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  image: string | null;
  tier: string;
  homeLatitude: number | null;
  homeLongitude: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AuthenticatedUser = SessionUser;
