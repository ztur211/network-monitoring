import type { Config } from 'jest';
import { base } from './jest.base.config';

const config: Config = {
  ...base,
  testRegex: '.*\\.e2e\\.ts$',
  coverageDirectory: '../coverage/e2e',
  testTimeout: 60000,
};

export default config;
