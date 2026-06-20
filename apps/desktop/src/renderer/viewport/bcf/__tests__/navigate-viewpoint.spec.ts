// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { navigateToViewpoint } from '../navigate-viewpoint';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

beforeEach(() => {
  // Merge reset: restores state fields without replacing the action functions
  useViewportStore.setState(initialViewportState());
});

const makeResolved = (overrides: Partial<Parameters<typeof navigateToViewpoint>[0]> = {}) => ({
  camera: {
    position: new THREE.Vector3(1, 2, 3),
    target: new THREE.Vector3(0, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    fov: 60,
  },
  selectionDeviceIds: [] as string[],
  selectionExpressIds: [] as number[],
  hiddenExpressIds: [] as number[],
  ...overrides,
});

describe('navigateToViewpoint', () => {
  it('sets camera viewpointRequest with correct position and nonce 1', () => {
    navigateToViewpoint(makeResolved());
    const s = useViewportStore.getState();
    expect(s.viewpointRequest?.nonce).toBe(1);
    expect(s.viewpointRequest?.camera.position.x).toBe(1);
    expect(s.viewpointRequest?.camera.fov).toBe(60);
  });

  it('increments nonce on repeated calls', () => {
    navigateToViewpoint(makeResolved());
    navigateToViewpoint(makeResolved());
    expect(useViewportStore.getState().viewpointRequest?.nonce).toBe(2);
  });

  it('applies camera + hidden + device selection to the stores', () => {
    navigateToViewpoint(makeResolved({
      selectionDeviceIds: ['dev1'],
      hiddenExpressIds: [9],
    }));
    const s = useViewportStore.getState();
    expect(s.selection).toEqual({ kind: 'device', deviceId: 'dev1' });
    expect([...s.hiddenElements]).toEqual([9]);
    expect(s.viewpointRequest?.camera.position.x).toBe(1);
  });

  it('falls back to element selection when no device', () => {
    navigateToViewpoint(makeResolved({
      selectionDeviceIds: [],
      selectionExpressIds: [42],
    }));
    expect(useViewportStore.getState().selection).toEqual({ kind: 'element', expressID: 42 });
  });

  it('clears selection when both lists empty', () => {
    useViewportStore.getState().selectNode('existing-dev');
    navigateToViewpoint(makeResolved({
      selectionDeviceIds: [],
      selectionExpressIds: [],
    }));
    expect(useViewportStore.getState().selection).toBeNull();
  });

  it('replaces (not adds to) hiddenElements', () => {
    useViewportStore.getState().hideElement(99);
    navigateToViewpoint(makeResolved({ hiddenExpressIds: [7] }));
    expect([...useViewportStore.getState().hiddenElements]).toEqual([7]);
  });
});
