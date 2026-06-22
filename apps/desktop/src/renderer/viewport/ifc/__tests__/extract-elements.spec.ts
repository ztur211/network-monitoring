// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { IfcAPI } from 'web-ifc';
import { extractElements } from '../extract-elements';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const wasmDir = dirname(require.resolve('web-ifc/web-ifc.wasm')) + '/';
const fixture = readFileSync(join(here, 'fixtures/wall.ifc'));

describe('extractElements', () => {
  let payloads: Awaited<ReturnType<typeof load>>;
  async function load() {
    const api = new IfcAPI();
    api.SetWasmPath(wasmDir, true);
    await api.Init();
    const id = api.OpenModel(new Uint8Array(fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength)), { COORDINATE_TO_ORIGIN: false });
    const out = extractElements(api, id);
    api.CloseModel(id);
    return out;
  }
  beforeAll(async () => { payloads = await load(); });

  it('returns typed-array payloads with geometry', () => {
    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) {
      expect(p.position).toBeInstanceOf(Float32Array);
      expect(p.normal).toBeInstanceOf(Float32Array);
      expect(p.color).toBeInstanceOf(Float32Array);
      expect(p.index).toBeInstanceOf(Uint32Array);
      expect(p.position.length).toBeGreaterThan(0);
      expect(p.position.length).toBe(p.normal.length);
      expect(p.position.length).toBe(p.color.length);
      expect(p.index.length).toBeGreaterThan(0); // non-empty index: vertices without indices render nothing
      expect(typeof p.ifcType).toBe('string');
    }
  });

  it('captures the wall GlobalId (Spec 6 BCF)', () => {
    const wall = payloads.find((p) => p.expressID === 30);
    expect(wall?.guid).toBe('2bjLUVfTLCM9P4iN8sefM6');
  });
});
