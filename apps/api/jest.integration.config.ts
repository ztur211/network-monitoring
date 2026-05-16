import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.repository\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage/integration',
  testEnvironment: 'node',
  testTimeout: 30000,
  moduleNameMapper: {
    '^@nodescope/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  globals: {
    'ts-jest': {
      tsconfig: {
        paths: {
          '@nodescope/shared': ['../../packages/shared/src/index.ts'],
        },
      },
    },
  },
};

export default config;
