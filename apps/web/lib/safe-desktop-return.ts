/**
 * Returns `raw` ONLY if it is a full absolute URL whose origin is the API origin
 * and whose path is the desktop-auth authorize endpoint. Otherwise null.
 * Prevents open-redirect / javascript:/data: / protocol-relative / cross-origin abuse
 * of the post-login redirect.
 */
export function safeDesktopReturnTo(raw: string | null, apiOrigin: string): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw); // absolute URLs only; relative paths and bare '//host' throw
  } catch {
    return null;
  }
  // javascript:/data: parse but have origin "null"; cross-origin won't match apiOrigin
  if (url.origin !== apiOrigin) return null;
  if (!url.pathname.startsWith('/api/v1/desktop-auth/authorize')) return null;
  return raw;
}
