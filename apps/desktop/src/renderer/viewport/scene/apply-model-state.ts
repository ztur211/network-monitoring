import * as THREE from 'three';
import type { ParsedModel, ExpressId, IfcType } from '../ifc/ifc-types';
import { isMeshVisible } from '../interaction/visibility';
import { sectionToPlane } from '../interaction/section';
import type { SectionState } from '../../stores/viewport-store';

const HIGHLIGHT = 0x3366ff;

export interface ModelViewState {
  selection: ExpressId | null;
  hiddenCategories: Set<IfcType>;
  hiddenElements: Set<ExpressId>;
  isolated: ExpressId | null;
  section: SectionState;
}

// Pure over three objects: reflect the store's visibility/selection/section onto each per-element mesh.
export function applyModelState(model: ParsedModel, s: ModelViewState): void {
  const plane = sectionToPlane(s.section);
  const planes = plane ? [plane] : null;
  for (const [id, mesh] of model.elementIndex) {
    mesh.visible = isMeshVisible(mesh, s);
    const mat = mesh.material as THREE.MeshLambertMaterial;
    mat.emissive.setHex(id === s.selection ? HIGHLIGHT : 0x000000);
    mat.clippingPlanes = planes;
    mat.needsUpdate = true;
  }
}
