import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'mjs', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.repository\\.spec\\.ts$',
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
  coverageDirectory: '../coverage/integration',
  testEnvironment: 'node',
  testTimeout: 30000,
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
