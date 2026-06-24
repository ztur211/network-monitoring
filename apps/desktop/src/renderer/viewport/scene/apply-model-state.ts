import * as THREE from 'three';
import type { ParsedModel, ExpressId, IfcType } from '../ifc/ifc-types';
import { sectionToPlane } from '../interaction/section';
import type { SectionState, Selection } from '../../stores/viewport-store';

export interface ModelViewState {
  selection: Selection;
  hiddenCategories: Set<IfcType>;
  hiddenElements: Set<ExpressId>;
  isolated: ExpressId | null;
  section: SectionState;
}

// Reflect store visibility/selection/section onto the merged model via its render controller.
export function applyModelState(model: ParsedModel, s: ModelViewState): void {
  model.render.applyVisibility({
    hiddenCategories: s.hiddenCategories,
    hiddenElements: s.hiddenElements,
    isolated: s.isolated,
  });
  model.render.applyHighlight(s.selection?.kind === 'element' ? s.selection.expressID : null);

  const plane = sectionToPlane(s.section);
  const planes = plane ? [plane] : null;
  const setClipping = (mat: THREE.MeshLambertMaterial) => {
    const hadPlanes = (mat.clippingPlanes?.length ?? 0) > 0;
    mat.clippingPlanes = planes;
    // Only a change in the NUMBER of clipping planes (null <-> [plane]) recompiles the shader.
    if (hadPlanes !== (planes !== null)) mat.needsUpdate = true;
  };
  for (const cat of model.render.categories.values()) {
    setClipping(cat.mesh.material as THREE.MeshLambertMaterial);
  }
  setClipping(model.render.overlay.material as THREE.MeshLambertMaterial);
}
