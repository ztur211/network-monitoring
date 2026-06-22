// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createWorkerIfcModelLoader } from '../ifc-worker-model-loader';
import { createIfcWorkerCore } from '../ifc-worker-core';
import { createIfcModelLoader } from '../ifc-model-loader';
import type { WorkerRequest, WorkerResponse } from '../element-payload';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const wasmDir = dirname(require.resolve('web-ifc/web-ifc.wasm')) + '/';
const fixture = readFileSync(join(here, 'fixtures/wall.ifc'));
const buf = () => fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength);

// A fake WorkerLike that runs the real core in-process and delivers responses async.
function fakeWorker() {
  let onmessage: ((e: { data: WorkerResponse }) => void) | null = null;
  const core = createIfcWorkerCore((m) => queueMicrotask(() => onmessage?.({ data: m })));
  return {
    get onmessage() { return onmessage; },
    set onmessage(fn) { onmessage = fn; },
    onerror: null,
    postMessage(m: WorkerRequest) { void core.handle(m); },
    terminate() {},
  };
}

describe('createWorkerIfcModelLoader', () => {
  it('produces a ParsedModel equivalent to the main-thread loader', async () => {
    const loader = createWorkerIfcModelLoader({ createWorker: fakeWorker, wasmPath: { path: wasmDir, absolute: true } });
    const model = await loader.loadModel(buf());
    expect(model.elementIndex.size).toBeGreaterThan(0);
    expect(model.guidIndex.get('2bjLUVfTLCM9P4iN8sefM6')).toBe(30);
    expect(model.guidIndex.size).toBe(model.elementIndex.size);
    expect(model.root.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
    const props = await model.getProperties(30);
    expect(props.name).toBe('Test Wall');
    model.dispose();
  });

  it('falls back to the main-thread loader when the worker cannot be constructed', async () => {
    const fallback = createIfcModelLoader({ wasmPath: { path: wasmDir, absolute: true } });
    const loader = createWorkerIfcModelLoader({
      createWorker: () => { throw new Error('worker boot failed'); },
      fallback,
    });
    const model = await loader.loadModel(buf());
    expect(model.elementIndex.size).toBeGreaterThan(0); // came from fallback
    model.dispose();
  });
});
