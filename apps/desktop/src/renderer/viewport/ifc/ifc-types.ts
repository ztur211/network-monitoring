import type * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';

export type IfcType = string; // web-ifc class name, e.g. 'IfcWallStandardCase'
export type ExpressId = number;

export interface VisibilityState {
  hiddenCategories: Set<IfcType>;
  hiddenElements: Set<ExpressId>;
  isolated: ExpressId | null;
}

/** One element's contiguous slice of a merged category index buffer. */
export interface ElementRange {
  expressID: ExpressId;
  indexStart: number; // offset into the merged index array (in index entries)
  indexCount: number; // index entries for this element (triangles × 3); 0 = no geometry
}
/** Ranges for one category, ascending by indexStart, covering [0, index.length). */
export type SortedRanges = ElementRange[];

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
  /** BCF Spec 6: IFC GlobalId (22-char base-64) → expressID reverse-lookup. */
  guidIndex: Map<string, ExpressId>;
  bbox: THREE.Box3; // in recentered (post-transform) space
  frame: { recenter: THREE.Vector3; upConversion: 'Z_UP_TO_Y_UP' }; // Spec 4 maps stored x/y/z via this
  getProperties(expressID: ExpressId): Promise<ElementProperties>;
  dispose(): void;
}

export interface IfcModelLoader {
  loadModel(bytes: ArrayBuffer): Promise<ParsedModel>;
}

export interface ElementRef {
  mesh: THREE.Mesh | null; // merged category mesh (null only for an all-empty category)
  ifcType: IfcType;
  indexStart: number;
  indexCount: number; // 0 = zero-geometry element
}
export interface CategoryRender {
  ifcType: IfcType;
  mesh: THREE.Mesh;
  fullIndex: Uint32Array;
  ranges: SortedRanges;
  pickBVH: MeshBVH | null;
}
export interface ModelRender {
  categories: Map<IfcType, CategoryRender>;
  meshes: THREE.Mesh[]; // category meshes + overlay, for assembleModel to add to the scene
  overlay: THREE.Mesh;
  elementIndex: Map<ExpressId, ElementRef>;
  applyVisibility(state: VisibilityState): void;
  applyHighlight(expressID: ExpressId | null): void;
  /** Nearest VISIBLE element under the ray + its world hit-point (for selection picking and device placement). */
  pick(ray: THREE.Raycaster, vis: VisibilityState): { expressID: ExpressId; point: THREE.Vector3 } | null;
  /** World-space bounding box of one element (for focus/frame). */
  elementBox(expressID: ExpressId): THREE.Box3 | null;
  dispose(): void;
}
