/**
 * Loaded before every test file. Injects `@jest/globals` into `globalThis` so
 * tests can use `jest.fn()` / `describe` / `expect` without a per-file import.
 * Mirrors the apps/api setup — jest's automatic `injectGlobals` does not work
 * in ESM mode (`--experimental-vm-modules`).
 */
import * as jestGlobals from '@jest/globals';

Object.assign(globalThis, jestGlobals);
