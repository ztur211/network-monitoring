// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createIfcWorkerCore } from '../ifc-worker-core';
import type { WorkerResponse } from '../element-payload';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const wasmDir = dirname(require.resolve('web-ifc/web-ifc.wasm')) + '/';
const fixture = readFileSync(join(here, 'fixtures/wall.ifc'));
const buf = () => fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength);

function drive() {
  const posts: WorkerResponse[] = [];
  const core = createIfcWorkerCore((m) => posts.push(m));
  return { posts, core };
}

describe('createIfcWorkerCore', () => {
  it('parses, streams element batches, then signals parsed', async () => {
    const { posts, core } = drive();
    await core.handle({ type: 'parse', jobId: 1, bytes: buf(), wasm: { path: wasmDir, absolute: true } });
    const elements = posts.filter((m) => m.type === 'elements');
    expect(elements.length).toBeGreaterThan(0);
    expect(posts.at(-1)).toMatchObject({ type: 'parsed', jobId: 1 });
    const total = elements.flatMap((m: any) => m.batch);
    expect(total.find((p: any) => p.expressID === 30)?.guid).toBe('2bjLUVfTLCM9P4iN8sefM6');
  });

  it('reads properties for an open model then disposes', async () => {
    const { posts, core } = drive();
    await core.handle({ type: 'parse', jobId: 2, bytes: buf(), wasm: { path: wasmDir, absolute: true } });
    await core.handle({ type: 'getProperties', jobId: 2, reqId: 7, expressID: 30 });
    const p = posts.find((m) => m.type === 'properties') as any;
    expect(p.props.name).toBe('Test Wall');
    expect(p.props.tag).toBe('WALL-001');
    await core.handle({ type: 'dispose', jobId: 2 }); // must not throw
  });
});
