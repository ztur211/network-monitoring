import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@nodescope/shared',
        replacement: fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      },
      {
        find: '@nodescope/client',
        replacement: fileURLToPath(new URL('../../packages/client/src/index.ts', import.meta.url)),
      },
      {
        find: /.*\/store\/ui\.store$/,
        replacement: fileURLToPath(
          new URL('./lib/__tests__/__mocks__/ui.store.ts', import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['{lib,store}/__tests__/*.spec.ts'],
  },
});
