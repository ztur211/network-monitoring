/**
 * Resolves the Express `trust proxy` setting from the optional `TRUST_PROXY` env
 * var. Express accepts:
 *   - a number  — count of proxy hops to trust (the right-most N entries of
 *                 X-Forwarded-For are treated as trusted infrastructure),
 *   - a boolean — `true` trusts the left-most XFF entry; `false` trusts none
 *                 (use the socket's address),
 *   - a string  — an IP / CIDR subnet / preset (e.g. 'loopback', 'uniquelocal'),
 *                 optionally comma-separated.
 *
 * Default is `1`: a single reverse proxy / load balancer directly in front of the
 * API (the DigitalOcean App Platform LB, or one Caddy hop). Behind a longer chain
 * — e.g. Cloudflare Tunnel → Caddy → API — set `TRUST_PROXY` so `req.ip` resolves
 * to the real client, which the per-IP AI rate limiter and `Network.checkOnHome`
 * depend on.
 */
export function resolveTrustProxy(raw: string | undefined): number | boolean | string {
  const value = (raw ?? '').trim();
  if (value === '') return 1;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  return value;
}
