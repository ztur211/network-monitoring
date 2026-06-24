import * as THREE from 'three';
import './bvh-setup';
import type { ElementPayload } from './element-payload';
import { mergeCategory } from './merge';
import { createModelRender } from './model-render';
import type { ParsedModel, IfcType, ExpressId, ElementProperties } from './ifc-types';

export interface AssemblyHooks {
  getProperties(id: number): Promise<ElementProperties>;
  dispose(): void;
}

/**
 * Assemble a ParsedModel from pre-extracted ElementPayloads, MERGING each IFC category into one
 * BufferGeometry/Mesh. Owns grouping, recentering, Z-up→Y-up, matrix freeze, bbox, and guidIndex;
 * the per-category merge + pick-BVH + visibility/highlight live in the ModelRender controller.
 */
export function assembleModel(payloads: ElementPayload[], hooks: AssemblyHooks): ParsedModel {
  // Group payloads by IFC category.
  const byType = new Map<IfcType, ElementPayload[]>();
  for (const p of payloads) {
    let arr = byType.get(p.ifcType);
    if (!arr) {
      arr = [];
      byType.set(p.ifcType, arr);
    }
    arr.push(p);
  }

  const merged = [...byType.entries()].map(([ifcType, ps]) => mergeCategory(ifcType, ps));
  const render = createModelRender(merged);

  const root = new THREE.Group();
  const recenterGroup = new THREE.Group();
  root.add(recenterGroup);
  for (const mesh of render.meshes) recenterGroup.add(mesh);

  // BCF Spec 6: IFC GlobalId → expressID, populated in lockstep with elements.
  const guidIndex = new Map<string, ExpressId>();
  for (const p of payloads) if (p.guid) guidIndex.set(p.guid, p.expressID);

  // Recenter (native frame) then convert Z-up → Y-up on root.
  const nativeBox = new THREE.Box3().setFromObject(recenterGroup);
  const recenter = nativeBox.getCenter(new THREE.Vector3());
  recenterGroup.position.set(-recenter.x, -recenter.y, -recenter.z);
  root.rotation.x = -Math.PI / 2;
  root.updateMatrixWorld(true);
  // Static after recentering — freeze per-object matrices so the render loop stops recomputing them.
  root.traverse((o) => {
    o.matrixAutoUpdate = false;
  });
  const bbox = new THREE.Box3().setFromObject(root);

  const categories = new Map<IfcType, THREE.Mesh>();
  for (const [ifcType, cat] of render.categories) categories.set(ifcType, cat.mesh);

  function dispose(): void {
    render.dispose();
    hooks.dispose();
  }

  return {
    root,
    categories,
    elementIndex: render.elementIndex,
    guidIndex,
    bbox,
    frame: { recenter, upConversion: 'Z_UP_TO_Y_UP' },
    render,
    getProperties: (id: ExpressId) => hooks.getProperties(id),
    dispose,
  };
}
