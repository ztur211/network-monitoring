import * as THREE from 'three';

/** Nearest marker's deviceId under the ray (or null). Markers are a flat list of leaf sprites,
 *  each carrying userData.deviceId; raycast non-recursively. Raycast priority over the building. */
export function pickNode(ray: THREE.Raycaster, markers: THREE.Object3D[]): string | null {
  const hits = ray.intersectObjects(markers, false);
  return hits.length ? ((hits[0].object.userData.deviceId as string) ?? null) : null;
}
