import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { ParsedModel } from '../ifc/ifc-types';
import { useViewportStore } from '../../stores/viewport-store';
import { getClients } from '../../data/clients';
import { commitPlacement, raycastBuildingPoint } from './placement';

/**
 * In-Canvas: while a device is in placing mode (`placingDeviceId`), the next click on the building
 * surface places it (raycast → toModel → PATCH, via commitPlacement). No hit ⇒ no-op (mid-air rejected),
 * placing mode stays for a retry. Esc cancels. Capture-phase so the placement click is not also a selection.
 */
export function PlacementController({
  model,
  notify,
}: {
  model: ParsedModel;
  notify?: (m: string) => void;
}) {
  const { gl, camera, raycaster } = useThree();
  const placingDeviceId = useViewportStore((s) => s.placingDeviceId);
  useEffect(() => {
    if (!placingDeviceId) return;
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
      const pt = raycastBuildingPoint(raycaster, model, {
        hiddenCategories: s.hiddenCategories,
        hiddenElements: s.hiddenElements,
        isolated: s.isolated,
      });
      const clients = getClients();
      if (pt && clients) {
        void commitPlacement(placingDeviceId, pt, {
          rest: clients.rest as never,
          frame: model.frame,
          notify,
        });
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') useViewportStore.getState().cancelPlace();
    };
    el.addEventListener('pointerdown', onDown, true); // capture: runs before PickingController
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [placingDeviceId, model, gl, camera, raycaster, notify]);
  return null;
}
