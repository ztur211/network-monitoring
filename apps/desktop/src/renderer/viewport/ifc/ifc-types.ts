import type * as THREE from 'three';

export type IfcType = string; // web-ifc class name, e.g. 'IfcWallStandardCase'
export type ExpressId = number;

export interface PropertyEntry {
  name: string;
  value: string;
}
export interface PropertySet {
  name: string;
  props: PropertyEntry[];
}
export interface ElementProperties {
  expressID: ExpressId;
  ifcType: IfcType;
  name: string | null;
  tag: string | null;
  propertySets: PropertySet[];
}

export interface ParsedModel {
  root: THREE.Group; // recentered, Y-up; add directly to a scene
  categories: Map<IfcType, THREE.Group>; // one child group per IFC class
  elementIndex: Map<ExpressId, THREE.Mesh>; // one merged mesh per element
  bbox: THREE.Box3; // in recentered (post-transform) space
  frame: { recenter: THREE.Vector3; upConversion: 'Z_UP_TO_Y_UP' }; // Spec 4 maps stored x/y/z via this
  getProperties(expressID: ExpressId): Promise<ElementProperties>;
  dispose(): void;
}

export interface IfcModelLoader {
  loadModel(bytes: ArrayBuffer): Promise<ParsedModel>;
}
