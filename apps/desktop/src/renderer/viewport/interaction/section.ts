import * as THREE from 'three';
import type { SectionState } from '../../stores/viewport-store';

const NORMALS: Record<SectionState['axis'], THREE.Vector3> = {
  X: new THREE.Vector3(-1, 0, 0),
  Y: new THREE.Vector3(0, -1, 0),
  Z: new THREE.Vector3(0, 0, -1),
};

/**
 * A THREE clipping plane that keeps the region on the negative side of the axis (cuts off the
 * positive side at `constant`): for Y, keeps points where -y + constant > 0 ⟹ y < constant.
 */
export function sectionToPlane(s: SectionState): THREE.Plane | null {
  if (!s.enabled) return null;
  const normal = NORMALS[s.axis].clone();
  return new THREE.Plane(normal, s.constant);
}
