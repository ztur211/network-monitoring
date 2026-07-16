// @vitest-environment node
import { describe, it, expect, beforeAll, vi } from 'vitest';
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

  it('deterministically deletes WebIFC geometry vectors', () => {
    const deleteGeometry = vi.fn();
    const deletePlacedVector = vi.fn();
    const deleteFlatVector = vi.fn();
    const geometry = {
      GetVertexData: () => 0,
      GetVertexDataSize: () => 6,
      GetIndexData: () => 0,
      GetIndexDataSize: () => 3,
      delete: deleteGeometry,
    };
    const placedVector = {
      size: () => 1,
      get: () => ({
        geometryExpressID: 2,
        flatTransformation: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        color: { x: 1, y: 1, z: 1 },
      }),
      delete: deletePlacedVector,
    };
    const flatVector = {
      size: () => 1,
      get: () => ({ expressID: 1, geometries: placedVector }),
      delete: deleteFlatVector,
    };
    const api = {
      LoadAllGeometry: () => flatVector,
      GetLineType: () => 1,
      GetNameFromTypeCode: () => 'IfcWall',
      GetGeometry: () => geometry,
      GetVertexArray: () => new Float32Array([0, 0, 0, 0, 0, 1]),
      GetIndexArray: () => new Uint32Array([0, 0, 0]),
      GetLine: () => ({ GlobalId: { value: 'guid' } }),
    } as unknown as IfcAPI;

    expect(extractElements(api, 0)).toHaveLength(1);
    expect(deleteGeometry).toHaveBeenCalledOnce();
    expect(deletePlacedVector).toHaveBeenCalledOnce();
    expect(deleteFlatVector).toHaveBeenCalledOnce();
  });
});
