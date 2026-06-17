import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'mjs', 'json', 'ts'],
  rootDir: 'src',
  testRegex: [
    '.*\\.(service|provider|state-machine|guard|interceptor|validator|cursor|adapter|config)\\.spec\\.ts$',
    // Spec 5: the export module's pure IFC primitives (ifc-guid, ifc2x3-writer) are unit tests.
    '.*/export/__tests__/.*\\.spec\\.ts$',
  ],
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
  coverageDirectory: '../coverage/unit',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/../jest.e2e.setup.ts'],
  transformIgnorePatterns: [
    '/node_modules/(?!(better-auth|better-call|@better-fetch|@better-auth)/)',
  ],
  moduleNameMapper: {
    '^@nodescope/shared$': '<rootDir>/../../../packages/shared/src/index.ts',
  },
};

export default config;
