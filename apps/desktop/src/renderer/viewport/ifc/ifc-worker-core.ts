import { IfcAPI } from 'web-ifc';
import { extractElements } from './extract-elements';
import { readProperties } from './read-properties';
import type { WorkerRequest, WorkerResponse } from './element-payload';

/** Number of ElementPayload items flushed per 'elements' message. */
export const BATCH_SIZE = 256;

/**
 * Transport-agnostic IFC worker logic. Instead of calling `postMessage` directly,
 * it calls the injected `post` callback — making it testable in Node without a real Worker.
 *
 * Usage in the real worker:
 *   const core = createIfcWorkerCore((msg, transfer) =>
 *     (self as unknown as Worker).postMessage(msg, transfer ?? [])
 *   );
 *
 * One IfcAPI instance per core; multiple open models keyed by jobId.
 */
export function createIfcWorkerCore(
  post: (msg: WorkerResponse, transfer?: Transferable[]) => void,
): { handle(req: WorkerRequest): Promise<void> } {
  const api = new IfcAPI();
  let inited = false;
  let initPromise: Promise<boolean> | null = null;

  // jobId → modelID (models kept open for getProperties calls until dispose)
  const openModels = new Map<number, number>();

  async function ensureInit(wasmPath: string, wasmAbsolute: boolean): Promise<boolean> {
    if (inited) return true;
    if (!initPromise) {
      initPromise = (async () => {
        try {
          api.SetWasmPath(wasmPath, wasmAbsolute);
          // forceSingleThread:true uses web-ifc.wasm (single-thread) and avoids
          // needing web-ifc-mt.wasm + SharedArrayBuffer/cross-origin isolation,
          // which a packaged file:// worker cannot satisfy.
          await api.Init(undefined, true);
          inited = true;
          return true;
        } catch {
          return false;
        }
      })();
    }
    return initPromise;
  }

  async function handleParse(req: Extract<WorkerRequest, { type: 'parse' }>): Promise<void> {
    const ok = await ensureInit(req.wasm.path, req.wasm.absolute);
    if (!ok) {
      post({ type: 'initError', jobId: req.jobId, message: 'web-ifc Init failed' });
      return;
    }

    let modelID: number;
    try {
      modelID = api.OpenModel(new Uint8Array(req.bytes), { COORDINATE_TO_ORIGIN: false });
    } catch (err: any) {
      post({ type: 'parseError', jobId: req.jobId, message: String(err?.message ?? err) });
      return;
    }

    // Keep model open for subsequent getProperties calls
    openModels.set(req.jobId, modelID);

    try {
      const payloads = extractElements(api, modelID);

      // Flush in batches, transferring all four ArrayBuffers per payload
      for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
        const batch = payloads.slice(i, i + BATCH_SIZE);
        const transfer: Transferable[] = [];
        for (const p of batch) {
          transfer.push(p.position.buffer, p.normal.buffer, p.color.buffer, p.index.buffer);
        }
        post({ type: 'elements', jobId: req.jobId, batch }, transfer);
      }

      post({ type: 'parsed', jobId: req.jobId });
    } catch (err: any) {
      try {
        api.CloseModel(modelID);
      } catch {
        /* already closed */
      }
      openModels.delete(req.jobId);
      post({ type: 'parseError', jobId: req.jobId, message: String(err?.message ?? err) });
    }
  }

  async function handleGetProperties(
    req: Extract<WorkerRequest, { type: 'getProperties' }>,
  ): Promise<void> {
    const modelID = openModels.get(req.jobId);
    if (modelID === undefined) {
      post({
        type: 'propertiesError',
        jobId: req.jobId,
        reqId: req.reqId,
        message: `No open model for jobId ${req.jobId}`,
      });
      return;
    }
    try {
      const props = await readProperties(api, modelID, req.expressID);
      post({ type: 'properties', jobId: req.jobId, reqId: req.reqId, props });
    } catch (err: any) {
      post({
        type: 'propertiesError',
        jobId: req.jobId,
        reqId: req.reqId,
        message: String(err?.message ?? err),
      });
    }
  }

  function handleDispose(req: Extract<WorkerRequest, { type: 'dispose' }>): void {
    const modelID = openModels.get(req.jobId);
    if (modelID !== undefined) {
      try {
        api.CloseModel(modelID);
      } catch {
        /* already closed */
      }
      openModels.delete(req.jobId);
    }
  }

  return {
    async handle(req: WorkerRequest): Promise<void> {
      switch (req.type) {
        case 'parse':
          return handleParse(req);
        case 'getProperties':
          return handleGetProperties(req);
        case 'dispose':
          handleDispose(req);
          break;
      }
    },
  };
}
