import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { ParsedModel } from '../ifc/ifc-types';
import { useViewportStore } from '../../stores/viewport-store';
import { fitCameraToBox } from './fit';
import { toViewport } from '../nodes/node-coords';

// Fix 3: module-level ref so IssuesPanel can read the live camera synchronously at click time.
type CameraSnapshot = { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fov: number };
let _liveCameraRef: CameraSnapshot | null = null;

/** Returns the most recently captured live camera state, or null before any frame runs. */
export function getLiveCamera(): CameraSnapshot | null {
  return _liveCameraRef;
}

// DOM→r3f camera commands via store nonces: fit the model, or frame the current selection.
export function ViewCommands({
  model,
  controls,
}: {
  model: ParsedModel;
  controls: RefObject<OrbitControlsImpl | null>;
}) {
  const { camera, size, invalidate } = useThree();
  const setCameraSnapshot = useViewportStore((s) => s.setCameraSnapshot);
  const controlsTarget = useRef(new THREE.Vector3());
  const fitNonce = useViewportStore((s) => s.fitNonce);
  const focusNonce = useViewportStore((s) => s.focusNonce);
  const viewpointNonce = useViewportStore((s) => s.viewpointRequest?.nonce);

  // Fix 3: update the live camera ref every frame (no throttle) so getLiveCamera() is always current.
  useFrame(() => {
    const target = controls.current?.target ?? controlsTarget.current;
    const snap: CameraSnapshot = {
      position: camera.position.clone(),
      target: target.clone(),
      up: camera.up.clone(),
      fov: (camera as THREE.PerspectiveCamera).fov ?? 50,
    };
    _liveCameraRef = snap;
    setCameraSnapshot(snap);
  });

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
      const box = model.render.elementBox(sel.expressID);
      if (box) frame(box);
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
    controlsTarget.current.copy(req.camera.target);
    invalidate();
  }, [viewpointNonce]);

  return null;
}
