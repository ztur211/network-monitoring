import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the workspace package to its SOURCE, not packages/shared/dist. The agent used to
      // import only types from shared (erased at build time), so nothing forced dist to be fresh;
      // now that it imports real code (nonOverlapping), a stale dist would silently test the wrong
      // implementation. Mirrors apps/api's jest moduleNameMapper.
      '@nodescope/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
