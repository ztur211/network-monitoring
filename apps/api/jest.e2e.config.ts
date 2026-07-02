import type { Config } from 'jest';
import { base } from './jest.base.config';

const config: Config = {
  ...base,
  testRegex: '.*\\.e2e\\.ts$',
  coverageDirectory: '../coverage/e2e',
  // Applies to hooks too. Every suite boots the full AppModule in beforeAll, and on a
  // loaded 4-core CI box (two jest workers compiling TS via vm-modules + booting apps,
  // alongside postgres/redis/minio) we've observed ~90s machine-wide stalls that blew
  // the previous 60s limit (run 28563491893). 180s keeps a genuine hang from dragging
  // on forever while giving worst-case contention real headroom.
  testTimeout: 180000,
};

export default config;
