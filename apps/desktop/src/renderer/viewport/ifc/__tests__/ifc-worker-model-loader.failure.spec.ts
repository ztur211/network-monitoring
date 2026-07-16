// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { WorkerRequest, WorkerResponse } from '../element-payload';

const assembleModel = vi.hoisted(() => vi.fn(() => { throw new Error('assembly failed'); }));
vi.mock('../scene-assembly', () => ({ assembleModel }));

import { createWorkerIfcModelLoader } from '../ifc-worker-model-loader';

describe('WorkerIfcModelLoader failure ownership', () => {
  it('disposes the worker-side model when main-thread assembly throws', async () => {
    let onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
    const requests: WorkerRequest[] = [];
    const worker = {
      get onmessage() { return onmessage; },
      set onmessage(fn: ((event: { data: WorkerResponse }) => void) | null) { onmessage = fn; },
      onerror: null as ((error: unknown) => void) | null,
      postMessage(message: WorkerRequest) {
        requests.push(message);
        if (message.type === 'parse') {
          const jobId = message.jobId;
          queueMicrotask(() => onmessage?.({ data: { type: 'parsed', jobId } }));
        }
      },
      terminate: vi.fn(),
    };
    const fallback = { loadModel: vi.fn(), dispose: vi.fn() };
    const loader = createWorkerIfcModelLoader({ createWorker: () => worker, fallback });

    await expect(loader.loadModel(new ArrayBuffer(8))).rejects.toThrow('assembly failed');

    expect(requests).toContainEqual({ type: 'dispose', jobId: 1 });
  });
});
