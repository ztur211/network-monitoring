import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { NodeLayer } from '../NodeLayer';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

const frameModel = () =>
  ({ frame: { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' as const } }) as any;

// merge reset so the store action fns survive
beforeEach(() => useViewportStore.setState(initialViewportState()));

describe('NodeLayer', () => {
  it('renders a marker only for placed devices', async () => {
    useViewportStore.getState().setDevices([
      { id: 'p', name: 'P', category: 'SWITCH', x: 1, y: 1, z: 1 } as any,
      { id: 'u', name: 'U', category: 'ROUTER', x: null, y: null, z: null } as any,
    ]);
    const r = await ReactThreeTestRenderer.create(
      <NodeLayer model={frameModel()} markersRef={{ current: [] }} />,
    );
    const sprites = r.scene.findAllByType('Sprite');
    expect(sprites.length).toBe(2); // one placed device → marker + status ring
    await r.unmount();
  });

  it('emphasises the selected device marker', async () => {
    useViewportStore.getState().setDevices([{ id: 'p', name: 'P', category: 'SWITCH', x: 1, y: 1, z: 1 } as any]);
    useViewportStore.getState().selectNode('p');
    const r = await ReactThreeTestRenderer.create(
      <NodeLayer model={frameModel()} markersRef={{ current: [] }} />,
    );
    const marker = r.scene.findAllByType('Sprite')[1]; // [0] = status ring, [1] = category marker
    expect(marker.instance.scale.x).toBeCloseTo(1.6, 5); // selected scale
    await r.unmount();
  });
});
