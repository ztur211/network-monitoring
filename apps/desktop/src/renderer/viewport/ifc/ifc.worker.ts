import { createIfcWorkerCore } from './ifc-worker-core';
import type { WorkerRequest } from './element-payload';

const core = createIfcWorkerCore((msg, transfer) =>
  (self as unknown as Worker).postMessage(msg, transfer ?? []),
);
self.onmessage = (e: MessageEvent<WorkerRequest>) => { void core.handle(e.data); };
