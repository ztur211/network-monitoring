import { useEffect, type RefObject } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { ParsedModel, ExpressId, VisibilityState } from '../ifc/ifc-types';
import { pickNode } from '../nodes/picking-nodes';
import { useViewportStore } from '../../stores/viewport-store';

// Nearest visible element's expressID under the ray (or null) — delegates to the merged-render pick.
export function pickExpressId(ray: THREE.Raycaster, model: ParsedModel, vis: VisibilityState): ExpressId | null {
  return model.render.pick(ray, vis)?.expressID ?? null;
}

/** Mounts inside <Canvas>: pointer-down → raycast markers first (→ device), else the building (→ element). */
export function PickingController({
  model,
  markersRef,
}: {
  model: ParsedModel;
  markersRef: RefObject<THREE.Object3D[]>;
}) {
  const { gl, camera, raycaster } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    if (!el) return; // headless (test-renderer) has no canvas element
    const onDown = (e: PointerEvent) => {
      if (useViewportStore.getState().placingDeviceId) return; // placing → click is a placement
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const s = useViewportStore.getState();
      const deviceId = pickNode(raycaster, markersRef.current); // markers take pick priority
      if (deviceId) {
        s.selectNode(deviceId);
        return;
      }
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
  }, [gl, camera, raycaster, model, markersRef]);
  return null;
}
