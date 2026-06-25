import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { DeviceModelLayer } from '../DeviceModelLayer';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';
import { toViewport } from '../../nodes/node-coords';
import { STATUS_COLOR } from '../../nodes/node-status';
import { pickNode } from '../../nodes/picking-nodes';

const frameModel = () =>
  ({ frame: { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' as const } }) as any;

beforeEach(() => useViewportStore.setState(initialViewportState()));

describe('DeviceModelLayer', () => {
  it('renders a group at toViewport(x,y,z) for a placed device', async () => {
    useViewportStore.getState().setDevices([
      { id: 'd1', name: 'SW1', category: 'SWITCH', x: 1, y: 2, z: 3 } as any,
      { id: 'u1', name: 'RT1', category: 'ROUTER', x: null, y: null, z: null } as any,
    ]);
    const m = frameModel();
    const r = await ReactThreeTestRenderer.create(
      <DeviceModelLayer model={m} markersRef={{ current: [] }} />,
    );
    // Only 1 placed device → 1 group (plus the root group)
    const groups = r.scene.findAllByType('Group');
    // Root group + one per-device group = at least 2 (the device group wraps the primitive)
    expect(groups.length).toBeGreaterThanOrEqual(2);

    // The per-device group should be at the correct viewport position
    const expected = toViewport({ x: 1, y: 2, z: 3 }, m.frame);
    const deviceGroup = groups.find(
      (g) =>
        Math.abs(g.instance.position.x - expected.x) < 0.001 &&
        Math.abs(g.instance.position.y - expected.y) < 0.001 &&
        Math.abs(g.instance.position.z - expected.z) < 0.001,
    );
    expect(deviceGroup).toBeDefined();
    await r.unmount();
  });

  it('markersRef contains ≥1 mesh tagged with deviceId', async () => {
    useViewportStore.getState().setDevices([
      { id: 'd1', name: 'SW1', category: 'SWITCH', x: 1, y: 1, z: 1 } as any,
    ]);
    const markersRef = { current: [] as THREE.Object3D[] };
    const r = await ReactThreeTestRenderer.create(
      <DeviceModelLayer model={frameModel()} markersRef={markersRef} />,
    );
    expect(markersRef.current.length).toBeGreaterThanOrEqual(1);
    const tagged = markersRef.current.filter((o) => (o.userData as any).deviceId === 'd1');
    expect(tagged.length).toBeGreaterThanOrEqual(1);
    await r.unmount();
  });

  it('body material color reflects nodeStatus', async () => {
    useViewportStore.getState().setDevices([
      { id: 'd1', name: 'SW1', category: 'SWITCH', x: 1, y: 1, z: 1 } as any,
    ]);
    useViewportStore.setState({ nodeStatus: new Map([['d1', 'down']]) });
    const markersRef = { current: [] as THREE.Object3D[] };
    const r = await ReactThreeTestRenderer.create(
      <DeviceModelLayer model={frameModel()} markersRef={markersRef} />,
    );
    // Find the body mesh (first mesh tagged with deviceId)
    const bodyMesh = markersRef.current.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
    expect(bodyMesh).toBeDefined();
    expect((bodyMesh!.material as THREE.MeshStandardMaterial).color.getHex()).toBe(STATUS_COLOR['down']);
    await r.unmount();
  });

  it('pickNode returns deviceId for a ray through the model mesh', async () => {
    useViewportStore.getState().setDevices([
      { id: 'd1', name: 'SW1', category: 'SWITCH', x: 0, y: 0, z: 0 } as any,
    ]);
    const markersRef = { current: [] as THREE.Object3D[] };
    const m = frameModel();
    const r = await ReactThreeTestRenderer.create(
      <DeviceModelLayer model={m} markersRef={markersRef} />,
    );
    // Bake matrixWorld for standalone test (no real scene)
    markersRef.current.forEach((o) => o.updateMatrixWorld(true));

    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    // Position camera above the device's viewport position
    const vp = toViewport({ x: 0, y: 0, z: 0 }, m.frame);
    cam.position.set(vp.x, vp.y + 10, vp.z);
    cam.lookAt(vp.x, vp.y, vp.z);
    cam.updateMatrixWorld();

    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), cam);

    const result = pickNode(ray, markersRef.current);
    expect(result).toBe('d1');
    await r.unmount();
  });

  it('selected device group has scale > 1 (highlight)', async () => {
    useViewportStore.getState().setDevices([
      { id: 'd1', name: 'SW1', category: 'SWITCH', x: 1, y: 1, z: 1 } as any,
    ]);
    useViewportStore.getState().selectNode('d1');
    const m = frameModel();
    const r = await ReactThreeTestRenderer.create(
      <DeviceModelLayer model={m} markersRef={{ current: [] }} />,
    );
    // The per-device group should have scale > 1 when selected
    const expected = toViewport({ x: 1, y: 1, z: 1 }, m.frame);
    const groups = r.scene.findAllByType('Group');
    const deviceGroup = groups.find(
      (g) =>
        Math.abs(g.instance.position.x - expected.x) < 0.001 &&
        Math.abs(g.instance.position.y - expected.y) < 0.001,
    );
    expect(deviceGroup).toBeDefined();
    expect(deviceGroup!.instance.scale.x).toBeCloseTo(1.15, 5);
    await r.unmount();
  });
});
