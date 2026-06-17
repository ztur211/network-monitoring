import { useEffect, type RefObject } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { ParsedModel } from '../ifc/ifc-types';
import { useViewportStore } from '../../stores/viewport-store';
import { fitCameraToBox } from './fit';

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
    const id = sel?.kind === 'element' ? sel.expressID : null;
    const mesh = id != null ? model.elementIndex.get(id) : null;
    if (mesh) frame(new THREE.Box3().setFromObject(mesh));
  }, [focusNonce]);

  return null;
}
