import type { Config } from '@jest/types';
import { base } from './jest.base.config';

const config: Config.InitialOptions = {
  ...base,
  testRegex: '.*\\.repository\\.spec\\.ts$',
  coverageDirectory: '../coverage/integration',
  testTimeout: 30000,
};

export default config;
