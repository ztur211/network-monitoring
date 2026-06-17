import { useViewportStore } from '../stores/viewport-store';

// The Spec 3 boundary: Spec 3 replaces this placeholder's body with the react-three-fiber
// <Canvas>, reading the active building (and the rest of viewportStore) for the render loop.
export function ViewportHost() {
  const buildingId = useViewportStore((s) => s.activeBuildingPropertyId);
  return (
    <main aria-label="viewport">
      {buildingId ? `3D viewport for ${buildingId} (Spec 3)` : 'Select a building'}
    </main>
  );
}
