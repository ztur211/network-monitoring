import type { ParsedModel, IfcModelLoader, ExpressId, ElementProperties } from './ifc-types';
import type { WorkerRequest, WorkerResponse, ElementPayload } from './element-payload';
import { assembleModel } from './scene-assembly';
import { createIfcModelLoader } from './ifc-model-loader';
import { defaultWasmPath } from './wasm-path';

export interface WorkerLike {
  postMessage(m: WorkerRequest, transfer?: Transferable[]): void;
  onmessage: ((e: { data: WorkerResponse }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  terminate(): void;
}

export interface WorkerLoaderOpts {
  createWorker?: () => WorkerLike;
  fallback?: IfcModelLoader;
  wasmPath?: { path: string; absolute: boolean };
}

// Default createWorker — lazy, only evaluated when called (never runs in Node test path).
// Vite rewrites the new URL(..., import.meta.url) form at build time.
// No {type:'module'} — Task 4 sets worker.format:'iife' for file:// compatibility.
const defaultCreateWorker = (): WorkerLike =>
  new Worker(new URL('./ifc.worker.ts', import.meta.url)) as unknown as WorkerLike;

// Job state held for an in-flight loadModel call.
interface JobState {
  payloads: ElementPayload[];
  onResponse(msg: WorkerResponse): void;
  onError(err: unknown): void;
}

// Pending getProperties request.
interface PendingProps {
  jobId: number;
  resolve(props: ElementProperties): void;
  reject(err: unknown): void;
}

export function createWorkerIfcModelLoader(opts: WorkerLoaderOpts = {}): IfcModelLoader {
  const makeWorker = opts.createWorker ?? defaultCreateWorker;
  const fallback = opts.fallback ?? createIfcModelLoader();
  const wasm = opts.wasmPath ?? defaultWasmPath();

  // Worker is lazily constructed on first loadModel call.
  let worker: WorkerLike | null = null;
  let degraded = false; // once true, all loads go to fallback
  let closed = false;

  // Sequence counters — monotonically increasing, never reused within a session.
  let nextJobId = 1;
  let nextReqId = 1;

  // In-flight jobs and pending property requests.
  const jobs = new Map<number, JobState>();
  const pendingProps = new Map<number, PendingProps>();

  // Drain all pending getProperties entries for a specific job, rejecting each.
  function drainPendingPropsForJob(jobId: number, err: Error): void {
    for (const [reqId, pending] of pendingProps) {
      if (pending.jobId === jobId) {
        pendingProps.delete(reqId);
        pending.reject(err);
      }
    }
  }

  // Drain ALL pending getProperties entries, rejecting each.
  function drainAllPendingProps(err: Error): void {
    for (const pending of pendingProps.values()) {
      pending.reject(err);
    }
    pendingProps.clear();
  }

  // Terminate and drop the worker reference. Called after degrading so the dead worker
  // thread and its web-ifc WASM instance do not leak for the loader's lifetime.
  // Safe to call even if the worker already crashed (guarded try/catch).
  function killWorker(): void {
    try { worker?.terminate(); } catch { /* already dead */ }
    worker = null;
  }

  // Obtain (or create) the shared worker. Returns null if construction fails.
  function ensureWorker(): WorkerLike | null {
    if (worker) return worker;
    try {
      const w = makeWorker();
      // Route all incoming responses.
      w.onmessage = (e: { data: WorkerResponse }) => handleResponse(e.data);
      w.onerror = (err: unknown) => {
        // Worker-level error — treat like an initError for all active jobs.
        degraded = true;
        const workerErr = err instanceof Error ? err : new Error(String(err));
        for (const job of jobs.values()) {
          job.onError(workerErr);
        }
        jobs.clear();
        // Also settle any in-flight getProperties so their promises don't leak.
        drainAllPendingProps(workerErr);
        // Terminate and drop the dead worker so its WASM instance doesn't leak.
        killWorker();
      };
      worker = w;
      return w;
    } catch {
      return null;
    }
  }

  function handleResponse(msg: WorkerResponse): void {
    switch (msg.type) {
      case 'elements': {
        const job = jobs.get(msg.jobId);
        if (job) {
          for (const p of msg.batch) job.payloads.push(p);
        }
        break;
      }
      case 'parsed': {
        const job = jobs.get(msg.jobId);
        if (job) {
          jobs.delete(msg.jobId);
          job.onResponse(msg);
        }
        break;
      }
      case 'initError': {
        // Worker is broken — degrade and drain ALL in-flight jobs (not just the triggering one).
        degraded = true;
        const initErr = new Error(msg.message);
        for (const job of jobs.values()) {
          job.onError(initErr);
        }
        jobs.clear();
        // Settle any pending getProperties so their promises don't leak.
        drainAllPendingProps(initErr);
        // Terminate and drop the dead worker so its WASM instance doesn't leak.
        killWorker();
        break;
      }
      case 'parseError': {
        // Model-specific error — do NOT degrade; reject only this job.
        const job = jobs.get(msg.jobId);
        if (job) {
          jobs.delete(msg.jobId);
          job.onError(new Error(msg.message));
        }
        break;
      }
      case 'properties': {
        const pending = pendingProps.get(msg.reqId);
        if (pending) {
          pendingProps.delete(msg.reqId);
          pending.resolve(msg.props);
        }
        break;
      }
      case 'propertiesError': {
        const pending = pendingProps.get(msg.reqId);
        if (pending) {
          pendingProps.delete(msg.reqId);
          pending.reject(new Error(msg.message));
        }
        break;
      }
    }
  }

  async function loadModel(bytes: ArrayBuffer): Promise<ParsedModel> {
    if (closed) throw new Error('IFC loader disposed');
    // If already degraded, always use fallback.
    if (degraded) return fallback.loadModel(bytes);

    const wOrNull = ensureWorker();
    if (!wOrNull) {
      // Construction failed — mark degraded and use fallback.
      degraded = true;
      return fallback.loadModel(bytes);
    }
    // Narrow to non-null for closure capture; TS loses narrowing across async closure boundaries.
    const w: WorkerLike = wOrNull;

    const jobId = nextJobId++;

    // workerResult resolves/rejects based on what the worker delivers.
    // If the worker signals initError, degraded will already be true by the time
    // onError fires, so we can transparently redirect to the fallback below.
    const workerResult = new Promise<ParsedModel>((resolve, reject) => {
      const payloads: ElementPayload[] = [];

      const onResponse = async (msg: WorkerResponse) => {
        if (msg.type !== 'parsed') return;

        // getProperties round-trips a message to the worker correlated by reqId.
        let disposed = false;
        function getProperties(expressID: ExpressId): Promise<ElementProperties> {
          return new Promise((res, rej) => {
            if (disposed) {
              rej(new Error('IFC model disposed'));
              return;
            }
            if (closed) {
              rej(new Error('IFC loader disposed'));
              return;
            }
            if (degraded || worker !== w) {
              rej(new Error('IFC worker unavailable'));
              return;
            }
            const reqId = nextReqId++;
            pendingProps.set(reqId, { jobId, resolve: res, reject: rej });
            try {
              w.postMessage({ type: 'getProperties', jobId, reqId, expressID });
            } catch (error) {
              pendingProps.delete(reqId);
              const workerError = error instanceof Error ? error : new Error(String(error));
              degraded = true;
              drainAllPendingProps(workerError);
              killWorker();
              rej(workerError);
            }
          });
        }

        // dispose posts 'dispose' to the worker, tears down THREE objects (via assembleModel's
        // dispose), and settles any in-flight getProperties for this job.
        function disposeHook(): void {
          if (disposed) return;
          disposed = true;
          drainPendingPropsForJob(jobId, new Error('IFC model disposed'));
          if (!closed && !degraded && worker === w) {
            try {
              w.postMessage({ type: 'dispose', jobId });
            } catch {
              degraded = true;
              killWorker();
            }
          }
        }

        try {
          // Yield to the event loop between batch accumulation and assembly so the renderer can paint.
          await new Promise<void>((r) => setTimeout(r, 0));
          if (closed) throw new Error('IFC loader disposed');
          if (degraded || worker !== w) throw new Error('IFC worker unavailable');
          const model = assembleModel(payloads, { getProperties, dispose: disposeHook });
          resolve(model);
        } catch (err) {
          try {
            disposeHook();
          } catch {
            /* worker may already be gone; preserve the assembly error */
          }
          reject(err);
        }
      };

      const onError = (err: unknown) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      jobs.set(jobId, { payloads, onResponse, onError });

      // Send bytes to the worker via structured-clone (NOT transfer).
      // The file buffer must remain valid on the main side so the initError→fallback
      // redirect can re-parse it.  The expensive zero-copy transfers are the per-element
      // geometry buffers sent worker→main (unaffected); this one-time clone of the file
      // buffer is negligible (a few MB, off the multi-second parse critical path).
      try {
        w.postMessage({ type: 'parse', jobId, bytes, wasm });
      } catch (error) {
        jobs.delete(jobId);
        degraded = true;
        const workerError = error instanceof Error ? error : new Error(String(error));
        drainAllPendingProps(workerError);
        killWorker();
        onError(workerError);
      }
    });

    // If the worker is now degraded (initError path), transparently fall back.
    // A parseError does NOT set degraded, so its rejection propagates normally.
    return workerResult.catch((err) => {
      if (degraded) return fallback.loadModel(bytes);
      throw err;
    });
  }

  function dispose(): void {
    if (closed) return;
    closed = true;
    const err = new Error('IFC loader disposed');
    for (const job of jobs.values()) job.onError(err);
    jobs.clear();
    drainAllPendingProps(err);
    killWorker();
    fallback.dispose();
  }

  return { loadModel, dispose };
}
