import { useEffect, useMemo, type RefObject } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { DeviceDto } from '@nodescope/shared';
import type { ParsedModel } from '../ifc/ifc-types';
import { useViewportStore } from '../../stores/viewport-store';
import { toViewport } from '../nodes/node-coords';
import { STATUS_COLOR, type NodeStatus } from '../nodes/node-status';
import { modelForCategory } from './device-model-registry';
import { buildProcMesh } from './proc-geometry';

const isPlaced = (d: DeviceDto) => d.x !== null && d.y !== null && d.z !== null;

/** Placed devices as 3D equipment objects: a per-category model at toViewport(x,y,z), meshes tagged with
 *  deviceId (registered into markersRef for pick→select), tinted by live status, selected one highlighted. */
export function DeviceModelLayer({
  model,
  markersRef,
}: {
  model: ParsedModel;
  markersRef: RefObject<THREE.Object3D[]>;
}) {
  const { invalidate } = useThree();
  const devices = useViewportStore((s) => s.devices);
  const selection = useViewportStore((s) => s.selection);
  const nodeStatus = useViewportStore((s) => s.nodeStatus);

  const placed = useMemo(() => devices.filter(isPlaced), [devices]);

  // Build geometry ONCE per placed set (id+category); tag meshes with deviceId. Dispose on rebuild/unmount.
  const items = useMemo(() => {
    return placed.map((d) => {
      const spec = modelForCategory(d.category) as Extract<ReturnType<typeof modelForCategory>, { kind: 'proc' }>;
      const grp = buildProcMesh(spec, STATUS_COLOR.unknown);
      grp.traverse((o) => { o.userData = { ...o.userData, deviceId: d.id }; });
      return { d, grp };
    });
  }, [placed]);

  useEffect(
    () => () => {
      items.forEach(({ grp }) =>
        grp.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.geometry.dispose();
            (m.material as THREE.Material).dispose();
          }
        }),
      );
    },
    [items],
  );

  // Tint bodies by live status (no geometry rebuild) + collect markers.
  // markersRef is collected from the built meshes here; R3F flushes matrixWorld on its render pass
  // before any user pointer interaction, so the picking raycast reads correct world positions.
  // `selection` is in the deps deliberately: it triggers invalidate() so the selection highlight
  // re-renders under frameloop="demand" (NOT a spurious dep — do not remove).
  useEffect(() => {
    const markers: THREE.Object3D[] = [];
    for (const { d, grp } of items) {
      const status: NodeStatus = nodeStatus.get(d.id) ?? 'unknown';
      // First child of the group is always the body mesh
      const body = grp.children.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
      if (body) {
        (body.material as THREE.MeshStandardMaterial).color.setHex(STATUS_COLOR[status]);
      }
      grp.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && (o.userData as { deviceId?: string }).deviceId) {
          markers.push(o);
        }
      });
    }
    markersRef.current = markers;
    invalidate();
  }, [items, nodeStatus, selection, markersRef, invalidate]);

  return (
    <group>
      {items.map(({ d, grp }) => {
        const p = toViewport({ x: d.x!, y: d.y!, z: d.z! }, model.frame);
        const selected = selection?.kind === 'device' && selection.deviceId === d.id;
        return (
          <group key={d.id} position={[p.x, p.y, p.z]} scale={selected ? 1.15 : 1}>
            <primitive object={grp} />
          </group>
        );
      })}
    </group>
  );
}
