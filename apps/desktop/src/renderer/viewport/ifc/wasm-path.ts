// In the renderer the wasm is bundled at the web root (electron.vite.config.ts), so web-ifc
// fetches `${path}web-ifc.wasm` from the app origin. Node tests pass an explicit absolute path.
export function defaultWasmPath(): { path: string; absolute: boolean } {
  return { path: '/', absolute: false };
}
