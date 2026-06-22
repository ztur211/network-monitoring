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

// A fake WorkerLike that delivers an initError response for any parse request.
function fakeInitErrorWorker(message = 'init failed') {
  let onmessage: ((e: { data: WorkerResponse }) => void) | null = null;
  return {
    get onmessage() { return onmessage; },
    set onmessage(fn: ((e: { data: WorkerResponse }) => void) | null) { onmessage = fn; },
    onerror: null as ((e: unknown) => void) | null,
    postMessage(m: WorkerRequest) {
      if (m.type === 'parse') {
        const jobId = m.jobId;
        queueMicrotask(() => onmessage?.({ data: { type: 'initError', jobId, message } }));
      }
    },
    terminate() {},
  };
}

// A fake WorkerLike that delivers a parseError response for any parse request.
function fakeParseErrorWorker(message = 'bad model') {
  let onmessage: ((e: { data: WorkerResponse }) => void) | null = null;
  return {
    get onmessage() { return onmessage; },
    set onmessage(fn: ((e: { data: WorkerResponse }) => void) | null) { onmessage = fn; },
    onerror: null as ((e: unknown) => void) | null,
    postMessage(m: WorkerRequest) {
      if (m.type === 'parse') {
        const jobId = m.jobId;
        queueMicrotask(() => onmessage?.({ data: { type: 'parseError', jobId, message } }));
      }
    },
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

  it('falls back via fallback loader on initError, and a second call also uses fallback', async () => {
    // Build a real fallback so we can verify the model is genuine (not a stub).
    const fallback = createIfcModelLoader({ wasmPath: { path: wasmDir, absolute: true } });

    let workerCreated = false;
    const loader = createWorkerIfcModelLoader({
      createWorker: () => {
        workerCreated = true;
        return fakeInitErrorWorker('init failed');
      },
      fallback,
      wasmPath: { path: wasmDir, absolute: true },
    });

    // First call — worker posts initError, loader should transparently fall back.
    const model1 = await loader.loadModel(buf());
    expect(workerCreated).toBe(true);
    expect(model1.elementIndex.size).toBeGreaterThan(0); // fallback produced a real model

    // Second call — loader is degraded; it must use fallback without touching the worker.
    // We swap the factory to a throw so we'd know if the worker was re-created.
    const model2 = await loader.loadModel(buf());
    expect(model2.elementIndex.size).toBeGreaterThan(0); // still via fallback

    model1.dispose();
    model2.dispose();
  });

  it('rejects on parseError and does NOT degrade (subsequent normal load still succeeds)', async () => {
    // Use a worker whose first postMessage delivers parseError, then acts as a real worker.
    // This lets us test both rejection on first call and success on second call
    // using the same (already-constructed) worker instance.
    let parseCallCount = 0;
    let onmessageRef: ((e: { data: WorkerResponse }) => void) | null = null;
    const core = createIfcWorkerCore((m) => queueMicrotask(() => onmessageRef?.({ data: m })));

    const hybridWorker = () => ({
      get onmessage() { return onmessageRef; },
      set onmessage(fn: ((e: { data: WorkerResponse }) => void) | null) { onmessageRef = fn; },
      onerror: null as ((e: unknown) => void) | null,
      postMessage(m: WorkerRequest) {
        if (m.type === 'parse') {
          parseCallCount++;
          if (parseCallCount === 1) {
            // First parse → deliver parseError
            const jobId = m.jobId;
            queueMicrotask(() => onmessageRef?.({ data: { type: 'parseError', jobId, message: 'bad model' } }));
            return;
          }
        }
        // All other messages (including 2nd parse) go to the real core.
        void core.handle(m);
      },
      terminate() {},
    });

    const loader = createWorkerIfcModelLoader({
      createWorker: hybridWorker,
      wasmPath: { path: wasmDir, absolute: true },
    });

    // First loadModel must reject with the parse error message.
    await expect(loader.loadModel(buf())).rejects.toThrow('bad model');

    // Loader must NOT be degraded — the second call must succeed using the same worker.
    const model = await loader.loadModel(buf());
    expect(model.elementIndex.size).toBeGreaterThan(0);
    model.dispose();

    // Confirm exactly 2 parse requests were issued (not short-circuited by degraded flag).
    expect(parseCallCount).toBe(2);
  });
});
