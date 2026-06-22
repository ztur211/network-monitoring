#!/usr/bin/env node
/*
 * ifc-worker-harness/gen.cjs — generate out/renderer/worker-test.html for the harness.
 *
 * Discovers the built ifc.worker-<hash>.js chunk (the hash changes per build) and inlines
 * out/renderer/test-fixture.ifc as base64 (a file:// page can't fetch() a sibling file).
 * The generated page constructs the worker, posts a `parse` request with the fixture bytes
 * and a file:// wasm path, and reports the streamed element count.
 *
 * Normally invoked by run.sh. Manual use: `npm run build` (so out/renderer exists), copy an
 * .ifc to out/renderer/test-fixture.ifc, then `node gen.cjs`.
 */
const fs = require('node:fs');
const path = require('node:path');

const RENDERER_DIR = path.join(__dirname, '..', '..', 'out', 'renderer');
const assetsDir = path.join(RENDERER_DIR, 'assets');
if (!fs.existsSync(assetsDir)) {
  console.error('ERROR: ' + assetsDir + ' missing — run `npm run build` in apps/desktop first.');
  process.exit(1);
}
const workerFile = fs.readdirSync(assetsDir).find((f) => /^ifc\.worker-.*\.js$/.test(f));
if (!workerFile) {
  console.error('ERROR: no ifc.worker-*.js chunk in ' + assetsDir + ' — rebuild.');
  process.exit(1);
}
const fixturePath = path.join(RENDERER_DIR, 'test-fixture.ifc');
if (!fs.existsSync(fixturePath)) {
  console.error('ERROR: no ' + fixturePath + ' — copy an .ifc there (run.sh does this).');
  process.exit(1);
}
const fixtureB64 = fs.readFileSync(fixturePath).toString('base64');

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
const FIXTURE_B64 = "${fixtureB64}";
const WORKER_URL = "./assets/${workerFile}";
(async () => {
  const log = (m) => console.log(m);
  try {
    const bin = atob(FIXTURE_B64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    log('FIXTURE_BYTES ' + bytes.byteLength);
    log('WORKER_URL ' + WORKER_URL);
    const wasm = { path: new URL('.', location.href).href, absolute: true };
    log('WASM_PATH ' + wasm.path);
    const w = new Worker(WORKER_URL);
    let elements = 0, batches = 0, firstType = null;
    w.onerror = (e) => log('WORKER_TEST_DONE WORKERERROR ' + (e.message || e.filename || 'construct/load failed'));
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'elements') { batches++; elements += m.batch.length; if (!firstType && m.batch[0]) firstType = m.batch[0].ifcType; }
      else if (m.type === 'parsed') log('WORKER_TEST_DONE OK elements=' + elements + ' batches=' + batches + ' firstType=' + firstType);
      else if (m.type === 'initError') log('WORKER_TEST_DONE INITERROR ' + m.message);
      else if (m.type === 'parseError') log('WORKER_TEST_DONE PARSEERROR ' + m.message);
    };
    w.postMessage({ type: 'parse', jobId: 1, bytes: bytes.buffer, wasm });
  } catch (err) { log('WORKER_TEST_DONE EXCEPTION ' + ((err && err.message) || err)); }
})();
</script></body></html>`;

fs.writeFileSync(path.join(RENDERER_DIR, 'worker-test.html'), html);
console.log('wrote worker-test.html (worker=' + workerFile + ', fixtureBytes=' + Buffer.from(fixtureB64, 'base64').length + ')');
