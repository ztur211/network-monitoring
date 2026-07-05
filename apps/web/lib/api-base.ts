/**
 * Resolve the base URL the web client uses to reach the NodeScope API.
 *
 * Priority:
 *  1. EXPO_PUBLIC_API_URL — an explicit build-time override (dev, or a
 *     split-origin deploy where the API lives on a different host).
 *  2. window.location.origin — the LAN-appliance case: the browser talks to
 *     the same origin it was served from, and Caddy proxies /api + /socket.io
 *     to the API. This is what lets the appliance work at any
 *     http://<box-ip>:<port> with no rebuild when the LAN IP changes.
 *  3. http://localhost:3000 — native / SSR / test fallback.
 */
export function resolveApiBaseUrl(): string {
  const explicit =
    typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_API_URL : undefined;
  if (explicit) return explicit;

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return 'http://localhost:3000';
}
