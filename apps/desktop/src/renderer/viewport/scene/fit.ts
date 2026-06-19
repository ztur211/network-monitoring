import * as THREE from 'three';

// Pure camera framing: target the box centre, pull back far enough that the bounding sphere fits.
export function fitCameraToBox(box: THREE.Box3, fovDeg = 50, aspect = 1) {
  const target = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  const sphere = box.isEmpty()
    ? new THREE.Sphere(target, 1)
    : box.getBoundingSphere(new THREE.Sphere());
  const r = Math.max(sphere.radius, 0.001);
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.001));
  const dist = r / Math.sin(Math.min(vFov, hFov) / 2);
  // place the camera on a pleasant 3/4 iso direction
  const dir = new THREE.Vector3(1, 0.8, 1).normalize();
  const position = target.clone().add(dir.multiplyScalar(dist * 1.1));
  return { position, target };
}
