// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { IfcAPI } from 'web-ifc';
import { extractElements } from '../extract-elements';
import { assembleModel } from '../scene-assembly';
import type { ParsedModel } from '../ifc-types';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const wasmDir = dirname(require.resolve('web-ifc/web-ifc.wasm')) + '/';
const fixture = readFileSync(join(here, 'fixtures/wall.ifc'));

describe('assembleModel (merged)', () => {
  let model: ParsedModel;

  beforeAll(async () => {
    const api = new IfcAPI();
    api.SetWasmPath(wasmDir, true);
    await api.Init();
    const id = api.OpenModel(
      new Uint8Array(fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength)),
      { COORDINATE_TO_ORIGIN: false },
    );
    const payloads = extractElements(api, id);
    api.CloseModel(id);
    model = assembleModel(payloads, { getProperties: async () => ({}) as any, dispose: () => {} });
  });

  it('merges to one mesh per IFC category (draw-call win)', () => {
    expect(model.categories.size).toBeGreaterThan(0);
    // One rendered mesh per category — NOT one per element.
    const renderedMeshes = model.render.meshes.filter((m) => m.userData.overlay !== true);
    expect(renderedMeshes.length).toBe(model.categories.size);
    expect(model.elementIndex.size).toBeGreaterThanOrEqual(model.categories.size);
    for (const mesh of model.categories.values()) {
      expect(mesh).toBeInstanceOf(THREE.Mesh);
      expect((mesh.geometry as THREE.BufferGeometry).getAttribute('position').count).toBeGreaterThan(0);
    }
  });

  it('every element maps to a valid range in its category mesh', () => {
    for (const [expressID, ref] of model.elementIndex) {
      expect(ref.ifcType).toEqual(expect.any(String));
      expect(model.categories.get(ref.ifcType)).toBe(ref.mesh);
      const total = (ref.mesh!.geometry as THREE.BufferGeometry).getIndex()!.count;
      expect(ref.indexStart).toBeGreaterThanOrEqual(0);
      expect(ref.indexStart + ref.indexCount).toBeLessThanOrEqual(total);
      expect(model.render.elementIndex.get(expressID)).toBe(ref);
    }
  });

  it('recenters and converts Z-up → Y-up', () => {
    expect(model.frame.upConversion).toBe('Z_UP_TO_Y_UP');
    expect(model.frame.recenter).toBeInstanceOf(THREE.Vector3);
    const c = model.bbox.getCenter(new THREE.Vector3());
    expect(Math.abs(c.x)).toBeLessThan(1e-3);
    expect(Math.abs(c.z)).toBeLessThan(1e-3);
    expect(model.root.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('guidIndex maps IFC GlobalIds to expressIDs (Spec 6 BCF)', () => {
    expect(model.guidIndex).toBeInstanceOf(Map);
    expect(model.guidIndex.get('2bjLUVfTLCM9P4iN8sefM6')).toBe(30);
    expect(model.guidIndex.size).toBe(model.elementIndex.size);
  });
});
