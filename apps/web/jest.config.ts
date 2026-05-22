import type { Config } from 'jest';

/**
 * Web jest config — covers pure-TS logic files only (lib/*, store/*).
 *
 * Per CLAUDE.md, NodeScope deliberately has no full frontend unit-test suite
 * (RN/JSX components are verified via Playwright). This config exists to lock
 * down a small set of regression-prone TS modules without standing up the
 * full RN preset.
 */
const config: Config = {
  moduleFileExtensions: ['js', 'mjs', 'json', 'ts', 'tsx'],
  rootDir: '.',
  testRegex: '(lib|store)/__tests__/.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j|mj)s$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.jest.json',
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  transformIgnorePatterns: [
    '/node_modules/(?!(better-auth|better-call|@better-fetch|@better-auth)/)',
  ],
  moduleNameMapper: {
    '^@nodescope/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    // Stub the Zustand-backed ui.store so websocket.service tests don't need
    // React/Zustand to load.
    '^(.+)/store/ui\\.store$': '<rootDir>/lib/__tests__/__mocks__/ui.store.ts',
    // zustand is hoisted to the root node_modules but `react` lives in the
    // workspace-local node_modules (RN/Expo pin react@19.2.6 in apps/web). Point
    // jest at the workspace copy so store unit tests can import zustand directly.
    '^react$': '<rootDir>/node_modules/react',
  },
};

export default config;
