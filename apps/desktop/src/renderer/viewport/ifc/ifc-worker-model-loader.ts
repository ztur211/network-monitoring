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

  // Sequence counters — monotonically increasing, never reused within a session.
  let nextJobId = 1;
  let nextReqId = 1;

  // In-flight jobs and pending property requests.
  const jobs = new Map<number, JobState>();
  const pendingProps = new Map<number, PendingProps>();

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
        for (const job of jobs.values()) {
          job.onError(err);
        }
        jobs.clear();
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
        // Worker is broken — degrade and redirect this job + all future ones.
        degraded = true;
        const job = jobs.get(msg.jobId);
        if (job) {
          jobs.delete(msg.jobId);
          job.onError(new Error(msg.message));
        }
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
    // If already degraded, always use fallback.
    if (degraded) return fallback.loadModel(bytes);

    const w = ensureWorker();
    if (!w) {
      // Construction failed — mark degraded and use fallback.
      degraded = true;
      return fallback.loadModel(bytes);
    }

    const jobId = nextJobId++;

    return new Promise<ParsedModel>((resolve, reject) => {
      const payloads: ElementPayload[] = [];

      const onResponse = async (msg: WorkerResponse) => {
        if (msg.type !== 'parsed') return;

        // getProperties round-trips a message to the worker correlated by reqId.
        function getProperties(expressID: ExpressId): Promise<ElementProperties> {
          return new Promise((res, rej) => {
            const reqId = nextReqId++;
            pendingProps.set(reqId, { resolve: res, reject: rej });
            w.postMessage({ type: 'getProperties', jobId, reqId, expressID });
          });
        }

        // dispose posts 'dispose' to the worker and tears down THREE objects (via assembleModel's dispose).
        function disposeHook(): void {
          w.postMessage({ type: 'dispose', jobId });
        }

        try {
          // Yield to the event loop between batch accumulation and assembly so the renderer can paint.
          await new Promise<void>((r) => setTimeout(r, 0));
          const model = assembleModel(payloads, { getProperties, dispose: disposeHook });
          resolve(model);
        } catch (err) {
          reject(err);
        }
      };

      const onError = (err: unknown) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      jobs.set(jobId, { payloads, onResponse, onError });

      // Send bytes to the worker — transfer the ArrayBuffer (zero-copy).
      w.postMessage({ type: 'parse', jobId, bytes, wasm }, [bytes]);
    });
  }

  return { loadModel };
}
