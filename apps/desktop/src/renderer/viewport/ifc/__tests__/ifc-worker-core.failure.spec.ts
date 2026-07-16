// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerResponse } from '../element-payload';

const fakes = vi.hoisted(() => ({
  api: {
    SetWasmPath: vi.fn(),
    Init: vi.fn().mockResolvedValue(undefined),
    OpenModel: vi.fn().mockReturnValue(17),
    CloseModel: vi.fn(),
  },
  extractElements: vi.fn(),
}));

vi.mock('web-ifc', () => ({
  IfcAPI: class {
    SetWasmPath(...args: unknown[]) { return fakes.api.SetWasmPath(...args); }
    Init(...args: unknown[]) { return fakes.api.Init(...args); }
    OpenModel(...args: unknown[]) { return fakes.api.OpenModel(...args); }
    CloseModel(...args: unknown[]) { return fakes.api.CloseModel(...args); }
  },
}));
vi.mock('../extract-elements', () => ({ extractElements: fakes.extractElements }));

import { createIfcWorkerCore } from '../ifc-worker-core';

describe('IfcWorkerCore failure ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.api.Init.mockResolvedValue(undefined);
    fakes.api.OpenModel.mockReturnValue(17);
  });

  it('closes and forgets an opened model when extraction throws', async () => {
    fakes.extractElements.mockImplementation(() => { throw new Error('extract failed'); });
    const posts: WorkerResponse[] = [];
    const core = createIfcWorkerCore((message) => posts.push(message));

    await core.handle({
      type: 'parse',
      jobId: 9,
      bytes: new ArrayBuffer(8),
      wasm: { path: '/wasm/', absolute: true },
    });
    await core.handle({ type: 'getProperties', jobId: 9, reqId: 3, expressID: 1 });

    expect(fakes.api.CloseModel).toHaveBeenCalledTimes(1);
    expect(fakes.api.CloseModel).toHaveBeenCalledWith(17);
    expect(posts[0]).toMatchObject({ type: 'parseError', jobId: 9, message: 'extract failed' });
    expect(posts[1]).toMatchObject({ type: 'propertiesError', jobId: 9, reqId: 3 });
    expect(posts.some((message) => message.type === 'parsed')).toBe(false);
  });
});
