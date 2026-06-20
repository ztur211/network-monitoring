// Resolve the wasm next to the loaded document so it works in BOTH the packaged build
// (main.loadFile → file:// origin) and dev (ELECTRON_RENDERER_URL → http origin). The
// electron-vite renderer output emits web-ifc.wasm alongside index.html. A bare "/" only
// works on an http origin; under file:// it resolves to the filesystem root and 404s.
// Node tests pass an explicit absolute path via LoaderOpts and never hit this branch.
export function defaultWasmPath(): { path: string; absolute: boolean } {
  if (typeof window !== 'undefined' && window.location?.href) {
    return { path: new URL('.', window.location.href).href, absolute: true };
  }
  return { path: '/', absolute: false };
}
