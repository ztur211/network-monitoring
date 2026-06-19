import { useEffect, type RefObject } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { ParsedModel } from '../ifc/ifc-types';
import { useViewportStore } from '../../stores/viewport-store';
import { fitCameraToBox } from './fit';
import { toViewport } from '../nodes/node-coords';

// DOM→r3f camera commands via store nonces: fit the model, or frame the current selection.
export function ViewCommands({
  model,
  controls,
}: {
  model: ParsedModel;
  controls: RefObject<OrbitControlsImpl | null>;
}) {
  const { camera, size, invalidate } = useThree();
  const fitNonce = useViewportStore((s) => s.fitNonce);
  const focusNonce = useViewportStore((s) => s.focusNonce);
  const viewpointNonce = useViewportStore((s) => s.viewpointRequest?.nonce);

  const frame = (box: THREE.Box3) => {
    const { position, target } = fitCameraToBox(
      box,
      (camera as THREE.PerspectiveCamera).fov,
      size.width / size.height,
    );
    camera.position.copy(position);
    camera.lookAt(target);
    if (controls.current) {
      controls.current.target.copy(target);
      controls.current.update();
    }
    invalidate();
  };

  useEffect(() => {
    if (fitNonce) frame(model.bbox);
  }, [fitNonce]);

  useEffect(() => {
    if (!focusNonce) return;
    const sel = useViewportStore.getState().selection;
    if (sel?.kind === 'element') {
      const mesh = model.elementIndex.get(sel.expressID);
      if (mesh) frame(new THREE.Box3().setFromObject(mesh));
    } else if (sel?.kind === 'device') {
      const dev = useViewportStore.getState().devices.find((x) => x.id === sel.deviceId);
      if (dev && dev.x !== null) {
        const p = toViewport({ x: dev.x, y: dev.y!, z: dev.z! }, model.frame);
        frame(new THREE.Box3().setFromCenterAndSize(p, new THREE.Vector3(4, 4, 4)));
      }
    }
  }, [focusNonce]);

  // Spec 6 Phase E: apply a BCF viewpoint camera (position/up/target) when requested.
  useEffect(() => {
    if (!viewpointNonce) return;
    const req = useViewportStore.getState().viewpointRequest;
    if (!req) return;
    camera.position.copy(req.camera.position);
    camera.up.copy(req.camera.up);
    camera.lookAt(req.camera.target);
    if (controls.current) {
      controls.current.target.copy(req.camera.target);
      controls.current.update();
    }
    invalidate();
  }, [viewpointNonce]);

  return null;
}
