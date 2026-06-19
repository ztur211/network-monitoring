import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'mjs', 'json', 'ts'],
  rootDir: 'src',
  testRegex: [
    '.*\\.(service|provider|state-machine|guard|interceptor|validator|cursor|adapter|config)\\.spec\\.ts$',
    // Spec 5: the export module's pure IFC primitives (ifc-guid, ifc2x3-writer) are unit tests.
    '.*/export/__tests__/.*\\.spec\\.ts$',
    // Spec 6: the bcf module's pure .bcfzip codec (bcf-zip) is a unit test.
    '.*/bcf/__tests__/.*\\.spec\\.ts$',
    // Spec 7: monitoring pure-logic tests (e.g. derive-state). DB-integration tests
    // in this module use the `.repository.spec.ts` suffix (→ jest.integration.config)
    // and are excluded here so they don't run twice / require a DB in the unit suite.
    '.*/monitoring/__tests__/(?!.*\\.repository\\.spec\\.ts$).*\\.spec\\.ts$',
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
    '^@nodescope/probe$': '<rootDir>/../../../packages/probe/src/index.ts',
  },
};

export default config;
