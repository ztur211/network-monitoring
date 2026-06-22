import type { ElementProperties } from './ifc-types';

export interface ElementPayload {
  expressID: number; // corresponds to the ExpressId alias in ifc-types.ts; kept as bare number so this transferable payload has no THREE/type-module dependency
  ifcType: string;
  guid?: string;
  position: Float32Array; // [x,y,z]* world-transformed
  normal: Float32Array;   // [x,y,z]* normal-matrix-transformed, normalized
  color: Float32Array;    // [r,g,b]* per vertex
  index: Uint32Array;     // triangle indices, base-offset accumulated
}

export type WorkerRequest =
  | { type: 'parse'; jobId: number; bytes: ArrayBuffer; wasm: { path: string; absolute: boolean } }
  | { type: 'getProperties'; jobId: number; reqId: number; expressID: number }
  | { type: 'dispose'; jobId: number };

export type WorkerResponse =
  | { type: 'elements'; jobId: number; batch: ElementPayload[] }
  | { type: 'parsed'; jobId: number }
  | { type: 'initError'; jobId: number; message: string }   // wasm/Init failure → loader falls back
  | { type: 'parseError'; jobId: number; message: string }  // valid worker, bad model
  | { type: 'properties'; jobId: number; reqId: number; props: ElementProperties }
  | { type: 'propertiesError'; jobId: number; reqId: number; message: string };
