import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { ParsedModel, ExpressId } from '../ifc/ifc-types';
import { isMeshVisible, type VisibilityState } from './visibility';
import { useViewportStore } from '../../stores/viewport-store';

// Pure: nearest visible mesh's expressID under the ray (or null). Testable without WebGL.
export function pickExpressId(
  ray: THREE.Raycaster,
  model: ParsedModel,
  vis: VisibilityState,
): ExpressId | null {
  const meshes = [...model.elementIndex.values()].filter((m) => isMeshVisible(m, vis));
  const hits = ray.intersectObjects(meshes, false);
  return hits.length ? ((hits[0].object.userData.expressID as ExpressId) ?? null) : null;
}

/** Mounts inside <Canvas>: pointer-down → raycast visible meshes → store.select. */
export function PickingController({ model }: { model: ParsedModel }) {
  const { gl, camera, raycaster } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    if (!el) return; // headless (test-renderer) has no canvas element
    const onDown = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const s = useViewportStore.getState();
      const id = pickExpressId(raycaster, model, {
        hiddenCategories: s.hiddenCategories,
        hiddenElements: s.hiddenElements,
        isolated: s.isolated,
      });
      if (id != null) s.selectElement(id);
      else s.clearSelection();
    };
    el.addEventListener('pointerdown', onDown);
    return () => el.removeEventListener('pointerdown', onDown);
  }, [gl, camera, raycaster, model]);
  return null;
}
