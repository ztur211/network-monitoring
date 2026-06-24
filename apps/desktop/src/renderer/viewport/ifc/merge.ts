import type { ElementPayload } from './element-payload';
import type { IfcType, ExpressId, SortedRanges } from './ifc-types';

export interface MergedCategory {
  ifcType: IfcType;
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  index: Uint32Array;
  ranges: SortedRanges;
}

/** Concatenate one IFC category's element payloads into a single merged geometry + range table. */
export function mergeCategory(ifcType: IfcType, payloads: ElementPayload[]): MergedCategory {
  let totalPos = 0;
  let totalIdx = 0;
  for (const p of payloads) {
    totalPos += p.position.length;
    totalIdx += p.index.length;
  }
  const position = new Float32Array(totalPos);
  const normal = new Float32Array(totalPos);
  const color = new Float32Array(totalPos);
  const index = new Uint32Array(totalIdx);
  const ranges: SortedRanges = [];

  let posOffset = 0; // in floats
  let idxOffset = 0; // in index entries
  for (const p of payloads) {
    const vertexBase = posOffset / 3;
    position.set(p.position, posOffset);
    normal.set(p.normal, posOffset);
    color.set(p.color, posOffset);
    for (let i = 0; i < p.index.length; i++) index[idxOffset + i] = p.index[i] + vertexBase;
    ranges.push({ expressID: p.expressID, indexStart: idxOffset, indexCount: p.index.length });
    posOffset += p.position.length;
    idxOffset += p.index.length;
  }
  return { ifcType, position, normal, color, index, ranges };
}

/** Binary-search the category ranges for the element owning a raycast faceIndex. */
export function faceIndexToExpressId(ranges: SortedRanges, faceIndex: number): ExpressId | null {
  const pos = faceIndex * 3; // index-buffer position of the face's first vertex
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid];
    if (pos < r.indexStart) hi = mid - 1;
    else if (pos >= r.indexStart + r.indexCount) lo = mid + 1;
    else return r.expressID;
  }
  return null;
}
