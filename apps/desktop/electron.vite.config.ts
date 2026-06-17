import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: { build: { outDir: 'out/main' } },
  preload: { build: { outDir: 'out/preload' } },
  renderer: {
    plugins: [react()],
    // @nodescope/client + @nodescope/shared are symlinked workspace packages shipped as CommonJS
    // (resolved outside node_modules), so the rollup commonjs transform must include packages/* to
    // extract their named exports; optimizeDeps pre-bundles them for the dev server.
    optimizeDeps: { include: ['@nodescope/client', '@nodescope/shared'] },
    build: {
      outDir: 'out/renderer',
      commonjsOptions: { include: [/packages\//, /node_modules/] },
    },
  },
});
