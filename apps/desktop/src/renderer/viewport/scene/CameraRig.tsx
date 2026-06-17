import { useEffect, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { fitCameraToBox } from './fit';

// Frames the model's bbox (fit) whenever it changes; demand-invalidates so the frame renders.
export function CameraRig({
  box,
  controls,
}: {
  box: THREE.Box3;
  controls: RefObject<OrbitControlsImpl | null>;
}) {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
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
  }, [box, camera, size.width, size.height, controls, invalidate]);
  return null;
}
