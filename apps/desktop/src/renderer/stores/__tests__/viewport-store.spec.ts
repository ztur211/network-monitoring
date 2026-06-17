import { describe, it, expect, beforeEach } from 'vitest';
import { useViewportStore, initialViewportState } from '../viewport-store';

// merge (not replace:true) so the action functions survive the reset
const reset = () => useViewportStore.setState(initialViewportState());

describe('viewportStore (Spec 3)', () => {
  beforeEach(reset);

  it('toggles a category on and off (new Set each time)', () => {
    const before = useViewportStore.getState().hiddenCategories;
    useViewportStore.getState().toggleCategory('IfcWall');
    expect(useViewportStore.getState().hiddenCategories.has('IfcWall')).toBe(true);
    expect(useViewportStore.getState().hiddenCategories).not.toBe(before); // immutable
    useViewportStore.getState().toggleCategory('IfcWall');
    expect(useViewportStore.getState().hiddenCategories.has('IfcWall')).toBe(false);
  });

  it('isolate / clearIsolation and hideElement', () => {
    useViewportStore.getState().isolate(42);
    expect(useViewportStore.getState().isolated).toBe(42);
    useViewportStore.getState().hideElement(7);
    expect(useViewportStore.getState().hiddenElements.has(7)).toBe(true);
    useViewportStore.getState().showAll();
    expect(useViewportStore.getState().isolated).toBeNull();
    expect(useViewportStore.getState().hiddenElements.size).toBe(0);
    expect(useViewportStore.getState().hiddenCategories.size).toBe(0);
  });

  it('setSection merges partials', () => {
    useViewportStore.getState().setSection({ enabled: true, axis: 'X', constant: 3 });
    expect(useViewportStore.getState().section).toEqual({ enabled: true, axis: 'X', constant: 3 });
    useViewportStore.getState().setSection({ constant: 5 });
    expect(useViewportStore.getState().section).toEqual({ enabled: true, axis: 'X', constant: 5 });
  });

  it('switching the active building resets per-model state', () => {
    useViewportStore.getState().select(9);
    useViewportStore.getState().isolate(9);
    useViewportStore.getState().toggleCategory('IfcSlab');
    useViewportStore.getState().setActiveBuilding('bld-2');
    const s = useViewportStore.getState();
    expect(s.activeBuildingPropertyId).toBe('bld-2');
    expect(s.selection).toBeNull();
    expect(s.isolated).toBeNull();
    expect(s.hiddenCategories.size).toBe(0);
  });

  it('reload bumps the nonce and clears updateAvailable', () => {
    useViewportStore.getState().flagUpdate();
    const n = useViewportStore.getState().reloadNonce;
    useViewportStore.getState().reload();
    expect(useViewportStore.getState().updateAvailable).toBe(false);
    expect(useViewportStore.getState().reloadNonce).toBe(n + 1);
  });
});
