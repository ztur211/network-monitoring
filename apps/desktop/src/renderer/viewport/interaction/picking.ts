import { useEffect, useMemo, type RefObject } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { ParsedModel, ExpressId, VisibilityState } from '../ifc/ifc-types';
import { pickNode } from '../nodes/picking-nodes';
import { buildGuidByExpressId, buildIfcLinkIndex, deviceForElement } from '../nodes/element-link';
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
  const guidByExpressId = useMemo(() => buildGuidByExpressId(model), [model]);
  useEffect(() => {
    const el = gl.domElement;
    if (!el) return; // headless (test-renderer) has no canvas element
    const onDown = (e: PointerEvent) => {
      const st = useViewportStore.getState();
      if (st.placingDeviceId || st.linkingDeviceId) return; // placing/linking → click is handled elsewhere
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
      if (id == null) {
        s.clearSelection();
        return;
      }
      // If the clicked BIM element is the network infrastructure a device points at (by GlobalId),
      // select the device — clicking the BIM object surfaces its live network info. Else select the element.
      const linked = deviceForElement(buildIfcLinkIndex(s.devices), guidByExpressId, id);
      if (linked) s.selectNode(linked.id);
      else s.selectElement(id);
    };
    el.addEventListener('pointerdown', onDown);
    return () => el.removeEventListener('pointerdown', onDown);
  }, [gl, camera, raycaster, model, markersRef, guidByExpressId]);
  return null;
}
