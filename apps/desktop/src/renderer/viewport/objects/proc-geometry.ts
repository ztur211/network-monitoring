import * as THREE from 'three';
import type { DeviceModelSpec } from './device-model-registry';

type Proc = Extract<DeviceModelSpec, { kind: 'proc' }>;

/** A recognizable equipment shape sitting on the floor (y≥0), body colored `color`. Pure: caller disposes. */
export function buildProcMesh(spec: Proc, color: number): THREE.Group {
  const g = new THREE.Group();
  const [w, h, d] = spec.size;
  const body =
    spec.shape === 'dome'
      ? new THREE.CylinderGeometry(w / 2, w / 2, h, 20)
      : new THREE.BoxGeometry(w, h, d);
  const bodyMesh = new THREE.Mesh(
    body,
    new THREE.MeshStandardMaterial({ color })
  );
  bodyMesh.position.y = h / 2;
  g.add(bodyMesh);
  if (spec.shape === 'rackbox') {
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.95, h * 0.6, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x222831 })
    );
    face.position.set(0, h / 2, d / 2 + 0.012);
    g.add(face);
  }
  return g;
}
