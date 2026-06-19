import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { PlacementController } from '../PlacementController';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

// merge reset so the store action fns survive
beforeEach(() => useViewportStore.setState(initialViewportState()));
const model = () =>
  ({ frame: { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' as const }, elementIndex: new Map() }) as any;

describe('PlacementController', () => {
  it('mounts inside a canvas without throwing (placing off)', async () => {
    const r = await ReactThreeTestRenderer.create(<PlacementController model={model()} />);
    expect(r.scene).toBeTruthy();
    await r.unmount();
  });
});
