import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.e2e\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage/e2e',
  testEnvironment: 'node',
  testTimeout: 60000,
  moduleNameMapper: {
    '^@nodescope/shared$': '<rootDir>/../../../packages/shared/src/index.ts',
    '^better-auth/node$': '<rootDir>/../__mocks__/better-auth-node.ts',
    '^better-auth$': '<rootDir>/../__mocks__/better-auth.ts',
    '^better-auth/adapters/prisma$': '<rootDir>/../__mocks__/better-auth-prisma.ts',
  },
};

export default config;
