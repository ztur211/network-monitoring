import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { ParsedModel } from '../ifc/ifc-types';
import { useViewportStore } from '../../stores/viewport-store';
import { getClients } from '../../data/clients';
import { pickExpressId } from '../interaction/picking';
import { buildGuidByExpressId } from './element-link';
import { commitLink } from './link';

/**
 * In-Canvas: while a device is in "link" mode (`linkingDeviceId`), the next click on a BIM element
 * links the device to that element's native IFC GlobalId (pick → guid → PATCH, via commitLink). An
 * element with no guid ⇒ notify + no-op (mode stays for a retry). Esc cancels. Capture-phase so the
 * link click is not also a selection (mirrors PlacementController).
 */
export function LinkController({
  model,
  notify,
}: {
  model: ParsedModel;
  notify?: (m: string) => void;
}) {
  const { gl, camera, raycaster } = useThree();
  const linkingDeviceId = useViewportStore((s) => s.linkingDeviceId);
  const guidByExpressId = useMemo(() => buildGuidByExpressId(model), [model]);
  useEffect(() => {
    if (!linkingDeviceId) return;
    const el = gl.domElement;
    if (!el) return; // headless (test-renderer) has no canvas element
    const onDown = (e: PointerEvent) => {
      e.stopImmediatePropagation();
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
      const guid = id != null ? guidByExpressId.get(id) : undefined;
      if (!guid) {
        notify?.('Click a BIM object with an IFC GlobalId to link it.');
        return;
      }
      const clients = getClients();
      if (clients) {
        void commitLink(linkingDeviceId, guid, { rest: clients.rest as never, notify });
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') useViewportStore.getState().cancelLink();
    };
    el.addEventListener('pointerdown', onDown, true); // capture: runs before PickingController
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [linkingDeviceId, model, gl, camera, raycaster, guidByExpressId, notify]);
  return null;
}
