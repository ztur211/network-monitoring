export interface ElementPayload {
  expressID: number;
  ifcType: string;
  guid?: string;
  position: Float32Array; // [x,y,z]* world-transformed
  normal: Float32Array;   // [x,y,z]* normal-matrix-transformed, normalized
  color: Float32Array;    // [r,g,b]* per vertex
  index: Uint32Array;     // triangle indices, base-offset accumulated
}
