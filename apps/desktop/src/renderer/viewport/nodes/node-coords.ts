import * as THREE from 'three';
import type { ParsedModel } from '../ifc/ifc-types';

type Frame = ParsedModel['frame'];
type Xyz = { x: number; y: number; z: number };

/**
 * M = Rx(-90°) · T(-recenter) — the same transform Spec 3 bakes into ParsedModel.root
 * (geometry recentered by -bbox-center, then root.rotation.x = -π/2). A device's stored
 * native x/y/z therefore maps to its world position under M, and a world-space raycast hit
 * maps back to native coords under M⁻¹.
 */
function frameMatrix(frame: Frame): THREE.Matrix4 {
  const r = frame.recenter;
  return new THREE.Matrix4()
    .makeRotationX(-Math.PI / 2)
    .multiply(new THREE.Matrix4().makeTranslation(-r.x, -r.y, -r.z));
}

/** Native (model-local, Z-up) device coords → viewport world position. */
export function toViewport(xyz: Xyz, frame: Frame): THREE.Vector3 {
  return new THREE.Vector3(xyz.x, xyz.y, xyz.z).applyMatrix4(frameMatrix(frame));
}

/** Viewport world position (e.g. a raycast hit) → native (model-local, Z-up) device coords. */
export function toModel(point: THREE.Vector3, frame: Frame): Xyz {
  const v = point.clone().applyMatrix4(frameMatrix(frame).invert());
  return { x: v.x, y: v.y, z: v.z };
}
