/**
 * BCF Spec 6 Phase D — capture-viewpoint
 *
 * Converts the current viewport camera + optional selected device into a BCF 2.1
 * viewpoint payload ready to POST to the server.
 *
 * All BCF camera vectors are in IFC native space (Z-up, pre-recentered). We
 * convert from the viewer's Y-up world space using the model's frame.
 *
 * Pure function — no side-effects. Returns the BCF viewpoint shape that the
 * API's BcfService expects.
 */

import * as THREE from 'three';
import type { ParsedModel } from '../ifc/ifc-types';
import { toModel, toModelDir } from '../nodes/node-coords';
import { toIfcGuid } from '@nodescope/shared';

export interface CapturedViewpoint {
  camera: {
    kind: 'perspective';
    position: [number, number, number];
    direction: [number, number, number];
    up: [number, number, number];
    fieldOfView: number;
  };
  components: {
    selection: string[];
    visibility: {
      defaultVisibility: boolean;
      exceptions: string[];
    };
  };
}

/**
 * Capture the current viewport camera state as a BCF 2.1 viewpoint.
 *
 * @param cam              Current Three.js camera state in Y-up world space:
 *                           position, target (look-at point), up vector, fov.
 * @param frame            Model frame (recenter + upConversion) for coordinate conversion.
 * @param selectedDeviceId Optional device UUID; when provided, its IFC GlobalId is
 *                         written into components.selection.
 */
export function captureViewpoint(
  cam: { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fov: number },
  frame: ParsedModel['frame'],
  selectedDeviceId?: string,
): CapturedViewpoint {
  // Convert Y-up viewport position → IFC native Z-up.
  const nativePosition = toModel(cam.position, frame);

  // Compute the normalized direction from position to target in native coords.
  const nativeTarget = toModel(cam.target, frame);
  const rawDir = {
    x: nativeTarget.x - nativePosition.x,
    y: nativeTarget.y - nativePosition.y,
    z: nativeTarget.z - nativePosition.z,
  };
  const len = Math.hypot(rawDir.x, rawDir.y, rawDir.z) || 1;
  const direction = { x: rawDir.x / len, y: rawDir.y / len, z: rawDir.z / len };

  // Convert up vector (rotation-only, no translation).
  const nativeUp = toModelDir(cam.up.clone(), frame);

  // Build BCF components: device selection (via toIfcGuid) or empty.
  const selection = selectedDeviceId ? [toIfcGuid(selectedDeviceId)] : [];

  return {
    camera: {
      kind: 'perspective' as const,
      position: [nativePosition.x, nativePosition.y, nativePosition.z] as [
        number,
        number,
        number,
      ],
      direction: [direction.x, direction.y, direction.z] as [number, number, number],
      up: [nativeUp.x, nativeUp.y, nativeUp.z] as [number, number, number],
      fieldOfView: cam.fov,
    },
    components: {
      selection,
      visibility: { defaultVisibility: true, exceptions: [] as string[] },
    },
  };
}
