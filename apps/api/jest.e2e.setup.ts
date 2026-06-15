/**
 * Loaded before any test file. Two responsibilities:
 *
 * 1. Force DATABASE_URL to the test database — production code reads it at
 *    module-load time, and we must NEVER accidentally hit dev/prod.
 *
 * 2. Inject jest globals (jest, describe, it, expect, …) into globalThis so
 *    test files don't need `import { jest } from '@jest/globals'` (which has
 *    very strict types that break legacy mock patterns). With this setup, the
 *    looser global types from `@types/jest` apply.
 *
 * jest's automatic `injectGlobals` does not work in ESM mode (`--experimental-
 * vm-modules`), so we have to do it explicitly.
 */
import * as jestGlobals from '@jest/globals';

Object.assign(globalThis, jestGlobals);

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

if (!process.env.DATABASE_URL?.includes(':5433/')) {
  process.env.DATABASE_URL =
    'postgresql://nodescope:localdevpassword@localhost:5433/nodescope_test';
}

process.env.BETTER_AUTH_SECRET ??= 'test-secret-minimum-32-characters-long-aaa';
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.FRONTEND_URL ??= 'http://localhost:8081';
process.env.REDIS_URL ??= 'redis://localhost:6380';
process.env.ANTHROPIC_API_KEY ??= 'test-dummy-key';
process.env.NODE_ENV ??= 'test';
process.env.STORAGE_ENDPOINT ??= 'http://localhost:9100';
process.env.STORAGE_BUCKET ??= 'nodescope-test';
process.env.STORAGE_ACCESS_KEY ??= 'minioadmin';
process.env.STORAGE_SECRET_KEY ??= 'minioadmin';
