import type { Config } from 'jest';
import { base } from './jest.base.config';

const config: Config = {
  ...base,
  testRegex: '.*\\.repository\\.spec\\.ts$',
  coverageDirectory: '../coverage/integration',
  testTimeout: 30000,
};

export default config;
