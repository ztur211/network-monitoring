import type { Config } from '@jest/types';
import { base } from './jest.base.config';

const config: Config.InitialOptions = {
  ...base,
  testRegex: '.*\\.e2e\\.ts$',
  coverageDirectory: '../coverage/e2e',
  // Clears throttle counters left in Redis by a previous run; without it a second local
  // run mass-fails with 429s. See the file header for the CI-vs-local difference.
  // rootDir is `src`, hence the `../` - matches setupFiles in jest.base.config.ts.
  globalSetup: '<rootDir>/../jest.e2e.globalSetup.ts',
  // Applies to hooks too. Every suite boots the full AppModule in beforeAll, and on a
  // loaded 4-core CI box (two jest workers compiling TS via vm-modules + booting apps,
  // alongside postgres/redis/minio) we've observed ~90s machine-wide stalls that blew
  // the previous 60s limit (run 28563491893). 180s keeps a genuine hang from dragging
  // on forever while giving worst-case contention real headroom.
  testTimeout: 180000,
};

export default config;
