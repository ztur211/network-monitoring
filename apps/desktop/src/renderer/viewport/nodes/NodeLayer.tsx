import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { DeviceDto } from '@nodescope/shared';
import type { ParsedModel } from '../ifc/ifc-types';
import { useViewportStore } from '../../stores/viewport-store';
import { toViewport } from './node-coords';
import { categoryColor } from './category-color';
import { STATUS_COLOR } from './node-status';

const isPlaced = (d: DeviceDto) => d.x !== null && d.y !== null && d.z !== null;

/**
 * In-Canvas: one billboard marker per PLACED device at toViewport(xyz), category-coloured, with a
 * status ring (§9 seam). Markers are added at world positions (not under model.root) and draw with
 * depthTest:false, so they are an annotation layer independent of building visibility/section/isolate.
 * Each leaf sprite carries userData.deviceId; they are collected into markersRef for marker-priority picking.
 */
export function NodeLayer({
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
  const groupRef = useRef<THREE.Group>(null);

  const placed = useMemo(() => devices.filter(isPlaced), [devices]);

  useEffect(() => {
    // Register the leaf marker sprites (each carrying deviceId) for picking, and redraw on demand.
    const markers: THREE.Object3D[] = [];
    groupRef.current?.traverse((o) => {
      if ((o.userData as { deviceId?: string })?.deviceId) markers.push(o);
    });
    markersRef.current = markers;
    invalidate();
  }, [placed, selection, nodeStatus, markersRef, invalidate]);

  return (
    <group ref={groupRef}>
      {placed.map((d) => {
        const p = toViewport({ x: d.x!, y: d.y!, z: d.z! }, model.frame);
        const selected = selection?.kind === 'device' && selection.deviceId === d.id;
        const status = nodeStatus.get(d.id) ?? 'unknown';
        const scale = selected ? 1.6 : 1.1;
        return (
          <group key={d.id} position={[p.x, p.y, p.z]}>
            {/* status ring behind the marker (also carries deviceId, so a ring hit selects the device) */}
            <sprite scale={[scale * 1.5, scale * 1.5, 1]} userData={{ deviceId: d.id }}>
              <spriteMaterial color={STATUS_COLOR[status]} opacity={0.5} transparent depthTest={false} />
            </sprite>
            {/* category-coloured marker */}
            <sprite scale={[scale, scale, 1]} userData={{ deviceId: d.id }}>
              <spriteMaterial color={categoryColor(d.category)} depthTest={false} />
            </sprite>
          </group>
        );
      })}
    </group>
  );
}
