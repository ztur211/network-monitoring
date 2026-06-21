import * as THREE from 'three';
import type { ParsedModel, ExpressId, IfcType } from '../ifc/ifc-types';
import { isMeshVisible } from '../interaction/visibility';
import { sectionToPlane } from '../interaction/section';
import type { SectionState, Selection } from '../../stores/viewport-store';

const HIGHLIGHT = 0x3366ff;

export interface ModelViewState {
  selection: Selection;
  hiddenCategories: Set<IfcType>;
  hiddenElements: Set<ExpressId>;
  isolated: ExpressId | null;
  section: SectionState;
}

// Pure over three objects: reflect the store's visibility/selection/section onto each per-element mesh.
export function applyModelState(model: ParsedModel, s: ModelViewState): void {
  const plane = sectionToPlane(s.section);
  const planes = plane ? [plane] : null;
  const selectedExpressId = s.selection?.kind === 'element' ? s.selection.expressID : null;
  for (const [id, mesh] of model.elementIndex) {
    mesh.visible = isMeshVisible(mesh, s);
    const mat = mesh.material as THREE.MeshLambertMaterial;
    mat.emissive.setHex(id === selectedExpressId ? HIGHLIGHT : 0x000000);
    // Only a change in the *number* of clipping planes (null <-> [plane]) alters the
    // compiled shader and needs a recompile. Emissive/visible/plane-position are uniform
    // or flag changes that do NOT. Flagging `needsUpdate` on every material on every call
    // recompiled the entire model on each selection/hover/section move — O(n) shader
    // rebuilds for a one-element highlight. Only dirty the material when clipping toggles.
    const hadPlanes = (mat.clippingPlanes?.length ?? 0) > 0;
    mat.clippingPlanes = planes;
    if (hadPlanes !== (planes !== null)) mat.needsUpdate = true;
  }
}
