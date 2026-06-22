export interface ElementPayload {
  expressID: number;
  ifcType: string;
  guid?: string;
  position: Float32Array; // [x,y,z]* world-transformed
  normal: Float32Array;   // [x,y,z]* normal-matrix-transformed, normalized
  color: Float32Array;    // [r,g,b]* per vertex
  index: Uint32Array;     // triangle indices, base-offset accumulated
}

import type { ElementProperties } from './ifc-types';

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
