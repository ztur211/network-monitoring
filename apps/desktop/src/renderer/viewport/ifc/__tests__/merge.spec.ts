// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mergeCategory } from '../merge';
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
