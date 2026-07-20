import type { Config } from '@jest/types';

/**
 * Shared jest settings for the api's three suites (unit / integration / e2e). These were byte-identical
 * across all three configs; each suite now spreads this base and overrides only what genuinely differs:
 * `testRegex` (which files it runs), `coverageDirectory`, and `testTimeout`.
 */
export const base: Config.InitialOptions = {
  moduleFileExtensions: ['js', 'mjs', 'json', 'ts'],
  rootDir: 'src',
  transform: {
    '^.+\\.(t|j|mj)s$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/../tsconfig.jest.json',
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  collectCoverageFrom: ['**/*.(t|j)s'],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/../jest.e2e.setup.ts'],
  transformIgnorePatterns: ['/node_modules/(?!(better-auth|better-call|@better-fetch|@better-auth)/)'],
  moduleNameMapper: {
    '^@nodescope/shared$': '<rootDir>/../../../packages/shared/src/index.ts',
    '^@nodescope/probe$': '<rootDir>/../../../packages/probe/src/index.ts',
  },
};
