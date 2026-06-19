import type * as THREE from 'three';
import type { IfcType, ExpressId } from '../ifc/ifc-types';

export interface VisibilityState {
  hiddenCategories: Set<IfcType>;
  hiddenElements: Set<ExpressId>;
  isolated: ExpressId | null;
}

// Pure → testable without WebGL. <ModelView> applies this to mesh.visible.
export function isMeshVisible(mesh: THREE.Mesh, s: VisibilityState): boolean {
  const { expressID, ifcType } = mesh.userData as { expressID: ExpressId; ifcType: IfcType };
  if (s.hiddenCategories.has(ifcType)) return false;
  if (s.hiddenElements.has(expressID)) return false;
  if (s.isolated !== null && s.isolated !== expressID) return false;
  return true;
}
