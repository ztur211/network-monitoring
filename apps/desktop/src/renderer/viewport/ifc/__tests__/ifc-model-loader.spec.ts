// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { createIfcModelLoader } from '../ifc-model-loader';
import type { ParsedModel } from '../ifc-types';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const wasmDir = dirname(require.resolve('web-ifc/web-ifc.wasm')) + '/';
const fixture = readFileSync(join(here, 'fixtures/wall.ifc'));

function fixtureBuffer(): ArrayBuffer {
  return fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength);
}

describe('IfcModelLoader', () => {
  let model: ParsedModel;
  beforeAll(async () => {
    const loader = createIfcModelLoader({ wasmPath: { path: wasmDir, absolute: true } });
    model = await loader.loadModel(fixtureBuffer());
  });

  it('parses elements into an indexed, categorized, Y-up group', () => {
    expect(model.elementIndex.size).toBeGreaterThan(0);
    expect(model.categories.size).toBeGreaterThan(0);
    for (const [expressID, ref] of model.elementIndex) {
      expect(ref.ifcType).toEqual(expect.any(String));
      expect(model.categories.get(ref.ifcType)).toBe(ref.mesh);
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
    // wall.ifc contains: #30=IFCWALL('2bjLUVfTLCM9P4iN8sefM6',...)
    // guidIndex must map that GlobalId → expressID 30.
    expect(model.guidIndex).toBeInstanceOf(Map);
    expect(model.guidIndex.size).toBeGreaterThan(0);
    const wallGuid = '2bjLUVfTLCM9P4iN8sefM6';
    expect(model.guidIndex.has(wallGuid)).toBe(true);
    expect(model.guidIndex.get(wallGuid)).toBe(30);
    // Every entry in guidIndex should have a corresponding entry in elementIndex
    // (guidIndex is populated only for elements that have renderable geometry).
    for (const [, expressID] of model.guidIndex) {
      expect(model.elementIndex.has(expressID)).toBe(true);
    }
    expect(model.guidIndex.size).toBe(model.elementIndex.size);
  });

  it('disposes without throwing and frees geometries', () => {
    const sampleMesh = [...model.categories.values()][0];
    expect(() => model.dispose()).not.toThrow();
    expect((sampleMesh.geometry as THREE.BufferGeometry).attributes.position).toBeUndefined();
  });

  it('getProperties returns type, name/tag and property sets for an element', async () => {
    const loader = createIfcModelLoader({ wasmPath: { path: wasmDir, absolute: true } });
    const m = await loader.loadModel(fixtureBuffer());
    const id = [...m.elementIndex.keys()][0];
    const props = await m.getProperties(id);
    expect(props.expressID).toBe(id);
    expect(props.ifcType.length).toBeGreaterThan(0);
    expect(props.name).toBe('Test Wall');
    expect(props.tag).toBe('WALL-001');
    const pset = props.propertySets.find((p) => p.name === 'Pset_WallCommon');
    expect(pset).toBeDefined();
    expect(pset!.props.find((p) => p.name === 'FireRating')?.value).toBe('2HR');
    for (const ps of props.propertySets) {
      expect(typeof ps.name).toBe('string');
      for (const p of ps.props) {
        expect(typeof p.name).toBe('string');
        expect(typeof p.value).toBe('string');
      }
    }
    m.dispose();
  });

  it('is idempotently disposable and rejects loads after disposal', async () => {
    const loader = createIfcModelLoader({ wasmPath: { path: wasmDir, absolute: true } });

    loader.dispose();
    loader.dispose();

    await expect(loader.loadModel(fixtureBuffer())).rejects.toThrow('IFC loader disposed');
  });
});
