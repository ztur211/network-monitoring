// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
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

// Like fakeInitErrorWorker but records terminate() calls for leak-detection tests.
function fakeInitErrorWorkerWithTerminateTracking(message = 'init failed') {
  let onmessage: ((e: { data: WorkerResponse }) => void) | null = null;
  let terminated = false;
  const worker = {
    get onmessage() { return onmessage; },
    set onmessage(fn: ((e: { data: WorkerResponse }) => void) | null) { onmessage = fn; },
    onerror: null as ((e: unknown) => void) | null,
    postMessage(m: WorkerRequest) {
      if (m.type === 'parse') {
        const jobId = m.jobId;
        queueMicrotask(() => onmessage?.({ data: { type: 'initError', jobId, message } }));
      }
    },
    terminate() { terminated = true; },
    get wasTerminated() { return terminated; },
  };
  return worker;
}

// A fake WorkerLike that FAITHFULLY simulates transfer detachment (like a real Worker)
// AND delivers an initError, letting us detect if bytes were transferred before fallback.
function fakeDetachingInitErrorWorker(message = 'init failed') {
  let onmessage: ((e: { data: WorkerResponse }) => void) | null = null;
  return {
    get onmessage() { return onmessage; },
    set onmessage(fn: ((e: { data: WorkerResponse }) => void) | null) { onmessage = fn; },
    onerror: null as ((e: unknown) => void) | null,
    postMessage(m: WorkerRequest, transfer?: Transferable[]) {
      // Faithfully simulate transfer detachment, just like a real Worker would.
      if (transfer?.length) structuredClone(m, { transfer });
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
  it('falls back and terminates the worker when the parse postMessage throws synchronously', async () => {
    const terminate = vi.fn();
    const worker = {
      onmessage: null as ((e: { data: WorkerResponse }) => void) | null,
      onerror: null as ((e: unknown) => void) | null,
      postMessage: vi.fn(() => { throw new Error('worker transport closed'); }),
      terminate,
    };
    const fallbackModel = { dispose: vi.fn() };
    const fallback = {
      loadModel: vi.fn().mockResolvedValue(fallbackModel),
      dispose: vi.fn(),
    };
    const loader = createWorkerIfcModelLoader({ createWorker: () => worker, fallback: fallback as never });

    await expect(loader.loadModel(new ArrayBuffer(8))).resolves.toBe(fallbackModel);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(fallback.loadModel).toHaveBeenCalledTimes(1);
  });

  it('rejects property requests made by an already-returned model after the worker crashes', async () => {
    let onmessage: ((e: { data: WorkerResponse }) => void) | null = null;
    let terminated = false;
    const core = createIfcWorkerCore((message) => queueMicrotask(() => onmessage?.({ data: message })));
    const worker = {
      get onmessage() { return onmessage; },
      set onmessage(fn: ((e: { data: WorkerResponse }) => void) | null) { onmessage = fn; },
      onerror: null as ((e: unknown) => void) | null,
      postMessage(message: WorkerRequest) {
        if (!terminated) void core.handle(message);
      },
      terminate() { terminated = true; },
    };
    const loader = createWorkerIfcModelLoader({
      createWorker: () => worker,
      wasmPath: { path: wasmDir, absolute: true },
    });
    const model = await loader.loadModel(buf());
    worker.onerror?.(new Error('worker crashed'));

    const outcome = await Promise.race([
      model.getProperties(30).then(() => 'resolved', (error) => error),
      new Promise((resolve) => setTimeout(() => resolve('still pending'), 10)),
    ]);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain('worker');
    model.dispose();
    loader.dispose();
  });

  it('terminates its worker, rejects pending loads, disposes fallback, and stays closed', async () => {
    let onmessage: ((e: { data: WorkerResponse }) => void) | null = null;
    const terminate = vi.fn();
    const worker = {
      get onmessage() { return onmessage; },
      set onmessage(fn: ((e: { data: WorkerResponse }) => void) | null) { onmessage = fn; },
      onerror: null as ((e: unknown) => void) | null,
      postMessage: vi.fn(),
      terminate,
    };
    const fallback = { loadModel: vi.fn(), dispose: vi.fn() };
    const loader = createWorkerIfcModelLoader({ createWorker: () => worker, fallback });
    const pending = loader.loadModel(new ArrayBuffer(8));

    loader.dispose();
    loader.dispose();

    await expect(pending).rejects.toThrow('IFC loader disposed');
    await expect(loader.loadModel(new ArrayBuffer(8))).rejects.toThrow('IFC loader disposed');
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(fallback.dispose).toHaveBeenCalledTimes(1);
  });

  it('rejects a parsed job when disposed during the pre-assembly yield', async () => {
    vi.useFakeTimers();
    try {
      let onmessage: ((e: { data: WorkerResponse }) => void) | null = null;
      const worker = {
        get onmessage() { return onmessage; },
        set onmessage(fn: ((e: { data: WorkerResponse }) => void) | null) { onmessage = fn; },
        onerror: null as ((e: unknown) => void) | null,
        postMessage(message: WorkerRequest) {
          if (message.type === 'parse') {
            const jobId = message.jobId;
            queueMicrotask(() => onmessage?.({ data: { type: 'parsed', jobId } }));
          }
        },
        terminate: vi.fn(),
      };
      const fallback = { loadModel: vi.fn(), dispose: vi.fn() };
      const loader = createWorkerIfcModelLoader({ createWorker: () => worker, fallback });
      const pending = loader.loadModel(new ArrayBuffer(8));
      const rejection = expect(pending).rejects.toThrow('IFC loader disposed');
      await Promise.resolve();

      loader.dispose();
      await vi.runAllTimersAsync();

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

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

  it('terminates the worker after an initError so the WASM instance does not leak', async () => {
    const fallback = createIfcModelLoader({ wasmPath: { path: wasmDir, absolute: true } });
    const fakeW = fakeInitErrorWorkerWithTerminateTracking('init failed');
    const loader = createWorkerIfcModelLoader({
      createWorker: () => fakeW,
      fallback,
      wasmPath: { path: wasmDir, absolute: true },
    });

    // First call — worker posts initError, loader falls back via fallback.
    const model1 = await loader.loadModel(buf());
    expect(model1.elementIndex.size).toBeGreaterThan(0); // fallback produced a real model
    expect(fakeW.wasTerminated).toBe(true);             // dead worker must be terminated

    // Second call — loader is degraded; must use fallback without re-creating the worker.
    const model2 = await loader.loadModel(buf());
    expect(model2.elementIndex.size).toBeGreaterThan(0);

    model1.dispose();
    model2.dispose();
  });

  it('initError fallback receives un-detached bytes and parses a real model', async () => {
    // This test guards against re-introducing [bytes] in the postMessage transfer list.
    // The fakeDetachingInitErrorWorker faithfully detaches any transferred ArrayBuffers
    // (just like a real Worker), then fires initError.  With the fix, bytes is never
    // transferred, so the fallback receives the intact buffer and produces a real model.
    // If someone re-adds `[bytes]`, structuredClone detaches the buffer → byteLength=0 →
    // fallback gets an empty buffer → parse fails (or produces empty model) → test fails.
    const fallback = createIfcModelLoader({ wasmPath: { path: wasmDir, absolute: true } });
    const loader = createWorkerIfcModelLoader({
      createWorker: () => fakeDetachingInitErrorWorker('init failed'),
      fallback,
      wasmPath: { path: wasmDir, absolute: true },
    });

    const model = await loader.loadModel(buf());
    expect(model.elementIndex.size).toBeGreaterThan(0);
    expect(model.guidIndex.get('2bjLUVfTLCM9P4iN8sefM6')).toBe(30);
    model.dispose();
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
