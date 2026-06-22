import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { copyFileSync, createReadStream } from 'node:fs';
import { resolve } from 'node:path';

// web-ifc's wasm is hoisted to the workspace root node_modules; resolve it robustly.
const require = createRequire(import.meta.url);
const webIfcWasm = require.resolve('web-ifc/web-ifc.wasm');

// Make web-ifc.wasm available at the renderer web root (IfcModelLoader fetches ./web-ifc.wasm):
// serve it in dev, copy it into the output on build. (vite-plugin-static-copy is incompatible with
// electron-vite's renderer build pipeline.)
const webIfcWasmPlugin = {
  name: 'copy-web-ifc-wasm',
  configureServer(server: any) {
    server.middlewares.use('/web-ifc.wasm', (_req: any, res: any) => {
      res.setHeader('Content-Type', 'application/wasm');
      createReadStream(webIfcWasm).pipe(res);
    });
  },
  writeBundle(options: any) {
    copyFileSync(webIfcWasm, resolve(options.dir, 'web-ifc.wasm'));
  },
};

export default defineConfig({
  main: { build: { outDir: 'out/main' } },
  preload: { build: { outDir: 'out/preload' } },
  renderer: {
    plugins: [react(), webIfcWasmPlugin],
    // @nodescope/client + @nodescope/shared are symlinked workspace packages shipped as CommonJS
    // (resolved outside node_modules), so the rollup commonjs transform must include packages/* to
    // extract their named exports; optimizeDeps pre-bundles them for the dev server.
    optimizeDeps: { include: ['@nodescope/client', '@nodescope/shared'] },
    build: {
      outDir: 'out/renderer',
      commonjsOptions: { include: [/packages\//, /node_modules/] },
    },
    // iife format instead of es: ES-module workers fail to load under the packaged file:// origin
    // because Chromium enforces a strict CORS/same-origin check for type:'module' workers on
    // file:// URLs. Classic (iife) workers have no such restriction and load fine under file://.
    worker: { format: 'iife' as const },
  },
});
