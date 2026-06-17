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
    for (const [expressID, mesh] of model.elementIndex) {
      expect(mesh.userData.expressID).toBe(expressID);
      expect(typeof mesh.userData.ifcType).toBe('string');
      expect(model.categories.get(mesh.userData.ifcType)?.children).toContain(mesh);
      expect((mesh.geometry as THREE.BufferGeometry).getAttribute('position').count).toBeGreaterThan(0);
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

  it('disposes without throwing and frees geometries', () => {
    const sample = [...model.elementIndex.values()][0];
    expect(() => model.dispose()).not.toThrow();
    expect((sample.geometry as THREE.BufferGeometry).attributes.position).toBeUndefined();
  });
});
