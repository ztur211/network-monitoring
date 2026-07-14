import { Logger } from '@nestjs/common';

const logger = new Logger('Env');

/**
 * Read a positive integer from the environment, falling back to `fallback` for anything that
 * is not one.
 *
 * The hand-rolled `parseInt(process.env.X ?? '30', 10)` pattern this replaces has two traps,
 * and both of them turn a typo in a .env file into a runaway:
 *
 *   - `??` only defaults on NULLISH. An env var that is set but EMPTY (a compose substitution
 *     of an unset variable, a k8s ConfigMap key with no value, `export FOO=`) is the empty
 *     string, which sails past `??`. `parseInt('')` is NaN, and `setInterval(fn, NaN)` does not
 *     throw - it coerces to 1ms. A scheduler meant to run every 30s then runs ~1000x/second.
 *   - `Number('')` is 0, not NaN, so the `Number(...)` variant of the same pattern yields an
 *     interval of 0: a hot loop that pegs a core.
 *
 * A misconfigured value must degrade to the default and SAY SO, never silently become an
 * unbounded workload. `min` exists so a caller can refuse a legal-but-catastrophic value
 * (an interval of 0, a concurrency of 0 which would stall a worker pool forever).
 */
export function envInt(name: string, fallback: number, opts: { min?: number; max?: number } = {}): number {
  const { min = 1, max } = opts;
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    logger.warn(`${name}="${raw}" is not an integer - falling back to ${fallback}.`);
    return fallback;
  }
  if (parsed < min) {
    logger.warn(`${name}=${parsed} is below the minimum of ${min} - falling back to ${fallback}.`);
    return fallback;
  }
  if (max !== undefined && parsed > max) {
    logger.warn(`${name}=${parsed} is above the maximum of ${max} - clamping to ${max}.`);
    return max;
  }
  return parsed;
}
