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
    // Resolve @nodescope/client to source (not its CommonJS dist) so the realtime client and its
    // @nodescope/shared re-export stay ESM/source under jest's experimental ESM runtime — matching
    // how @nodescope/shared is resolved above. websocket.service is a thin adapter over this client.
    '^@nodescope/client$': '<rootDir>/../../packages/client/src/index.ts',
    // Stub the Zustand-backed ui.store so websocket.service tests don't need
    // React/Zustand to load.
    '^(.+)/store/ui\\.store$': '<rootDir>/lib/__tests__/__mocks__/ui.store.ts',
    // Pin `react` to its single installed copy. npm may hoist react to the root
    // node_modules (monorepo) or keep it workspace-local depending on the install,
    // so a hardcoded path is fragile; require.resolve finds it either way and
    // guarantees store unit tests and zustand share one react instance.
    '^react$': require.resolve('react'),
  },
};

export default config;
