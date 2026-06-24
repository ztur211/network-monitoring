// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mergeCategory, faceIndexToExpressId, buildVisibleIndex } from '../merge';
import type { ElementPayload } from '../element-payload';

const payload = (expressID: number, verts: number[], idx: number[]): ElementPayload => ({
  expressID,
  ifcType: 'IfcWall',
  guid: `g${expressID}`,
  position: new Float32Array(verts),
  normal: new Float32Array(verts.map(() => 0)),
  color: new Float32Array(verts.map(() => 1)),
  index: new Uint32Array(idx),
});

describe('mergeCategory', () => {
  it('concatenates buffers and offsets indices by each element vertex base', () => {
    const a = payload(1, [0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]); // 3 verts
    const b = payload(2, [2, 0, 0, 3, 0, 0, 2, 1, 0], [0, 1, 2]); // 3 verts
    const m = mergeCategory('IfcWall', [a, b]);

    expect(m.ifcType).toBe('IfcWall');
    expect(m.position).toHaveLength(18);
    expect(m.index).toBeInstanceOf(Uint32Array);
    // b's indices are offset by a's 3 vertices.
    expect(Array.from(m.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(m.ranges).toEqual([
      { expressID: 1, indexStart: 0, indexCount: 3 },
      { expressID: 2, indexStart: 3, indexCount: 3 },
    ]);
  });

  it('handles a zero-geometry element as a count-0 range', () => {
    const m = mergeCategory('IfcWall', [payload(9, [], [])]);
    expect(m.index).toHaveLength(0);
    expect(m.ranges).toEqual([{ expressID: 9, indexStart: 0, indexCount: 0 }]);
  });
});

describe('faceIndexToExpressId', () => {
  const ranges = [
    { expressID: 10, indexStart: 0, indexCount: 6 }, // faces 0..1
    { expressID: 20, indexStart: 6, indexCount: 3 }, // face 2
    { expressID: 30, indexStart: 9, indexCount: 6 }, // faces 3..4
  ];
  it('maps a face index to the owning element via its index range', () => {
    expect(faceIndexToExpressId(ranges, 0)).toBe(10); // pos 0
    expect(faceIndexToExpressId(ranges, 1)).toBe(10); // pos 3
    expect(faceIndexToExpressId(ranges, 2)).toBe(20); // pos 6
    expect(faceIndexToExpressId(ranges, 3)).toBe(30); // pos 9
    expect(faceIndexToExpressId(ranges, 4)).toBe(30); // pos 12
  });
  it('returns null past the end', () => {
    expect(faceIndexToExpressId(ranges, 5)).toBeNull(); // pos 15, out of range
  });
});

describe('buildVisibleIndex', () => {
  const full = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const ranges = [
    { expressID: 10, indexStart: 0, indexCount: 3 },
    { expressID: 20, indexStart: 3, indexCount: 3 },
    { expressID: 30, indexStart: 6, indexCount: 3 },
  ];
  it("returns 'all' when every element is visible", () => {
    expect(buildVisibleIndex(full, ranges, () => true)).toBe('all');
  });
  it("returns 'none' when nothing is visible", () => {
    expect(buildVisibleIndex(full, ranges, () => false)).toBe('none');
  });
  it('returns only the visible ranges concatenated', () => {
    const out = buildVisibleIndex(full, ranges, (id) => id !== 20);
    expect(out).toBeInstanceOf(Uint32Array);
    expect(Array.from(out as Uint32Array)).toEqual([0, 1, 2, 6, 7, 8]);
  });
});
