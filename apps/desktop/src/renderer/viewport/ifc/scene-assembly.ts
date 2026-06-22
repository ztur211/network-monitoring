import * as THREE from 'three';
import './bvh-setup'; // patches THREE prototypes so computeBoundsTree() is available
import type { ElementPayload } from './element-payload';
import type { ParsedModel, IfcType, ExpressId, ElementProperties } from './ifc-types';

export interface AssemblyHooks {
  getProperties(id: number): Promise<ElementProperties>;
  dispose(): void;
}

/**
 * Assemble a ParsedModel (THREE scene graph) from pre-extracted ElementPayload typed arrays.
 * This function owns THREE object creation, BVH build, recentering, Z-up→Y-up conversion,
 * matrix freeze, and bbox computation.
 *
 * The returned model's `dispose()` tears down ALL THREE objects and then calls `hooks.dispose()`.
 */
export function assembleModel(payloads: ElementPayload[], hooks: AssemblyHooks): ParsedModel {
  const root = new THREE.Group();
  const recenterGroup = new THREE.Group(); // meshes in native frame; offset after bbox
  root.add(recenterGroup);
  const categories = new Map<IfcType, THREE.Group>();
  const elementIndex = new Map<ExpressId, THREE.Mesh>();
  const guidIndex = new Map<string, ExpressId>(); // BCF Spec 6: IFC GlobalId → expressID

  for (const payload of payloads) {
    const { expressID, ifcType, guid } = payload;

    // Zero-copy: Float32BufferAttribute wraps the typed array directly.
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(payload.position, 3));
    bg.setAttribute('normal', new THREE.Float32BufferAttribute(payload.normal, 3));
    bg.setAttribute('color', new THREE.Float32BufferAttribute(payload.color, 3));
    bg.setIndex(new THREE.BufferAttribute(payload.index, 1));
    bg.computeBoundsTree(); // build the BVH once at load → fast picking raycasts

    const mesh = new THREE.Mesh(
      bg,
      new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    );
    mesh.userData = { expressID, ifcType };

    if (guid) guidIndex.set(guid, expressID);

    let group = categories.get(ifcType);
    if (!group) {
      group = new THREE.Group();
      group.name = ifcType;
      categories.set(ifcType, group);
      recenterGroup.add(group);
    }
    group.add(mesh);
    elementIndex.set(expressID, mesh);
  }

  // Recenter (native frame) then convert Z-up → Y-up on root.
  const nativeBox = new THREE.Box3().setFromObject(recenterGroup);
  const recenter = nativeBox.getCenter(new THREE.Vector3());
  recenterGroup.position.set(-recenter.x, -recenter.y, -recenter.z);
  root.rotation.x = -Math.PI / 2;
  root.updateMatrixWorld(true);
  // The building is static after recentering — it's never transformed again. Freeze
  // per-object matrices (already baked by updateMatrixWorld above) so the render loop
  // stops recomputing world matrices for thousands of meshes every frame.
  root.traverse((o) => {
    o.matrixAutoUpdate = false;
  });
  const bbox = new THREE.Box3().setFromObject(root);

  function dispose(): void {
    for (const mesh of elementIndex.values()) {
      mesh.geometry.disposeBoundsTree?.();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.geometry.deleteAttribute('position');
      mesh.geometry.deleteAttribute('normal');
      mesh.geometry.deleteAttribute('color');
    }
    elementIndex.clear();
    categories.clear();
    hooks.dispose();
  }

  return {
    root,
    categories,
    elementIndex,
    guidIndex,
    bbox,
    frame: { recenter, upConversion: 'Z_UP_TO_Y_UP' },
    getProperties: (id: ExpressId) => hooks.getProperties(id),
    dispose,
  };
}
