/**
 * BCF Spec 6 Phase D — apply-viewpoint
 *
 * Converts a BCF 2.1 viewpoint (camera + component selection/visibility) into
 * the viewport camera state and store mutations needed to reproduce it.
 *
 * All BCF camera vectors are in IFC native space (Z-up, pre-recentered). We
 * convert them to the viewer's Y-up world space using the model's frame.
 *
 * Returns a plain value object with no side-effects. The caller (e.g. a
 * React hook) drives the Three.js camera and dispatches the store mutations.
 *
 * Component GUIDs are split into:
 *  - selectionDeviceIds: device UUIDs (looked up via deviceGuidMap)
 *  - selectionExpressIds: IFC element expressIDs (looked up via guidIndex)
 */

import * as THREE from 'three';
import type { ParsedModel, ExpressId } from '../ifc/ifc-types';
import { toViewport, toViewportDir } from '../nodes/node-coords';

/** The result of applying a BCF viewpoint: desired camera state + resolved component lists. */
export interface ResolvedViewpoint {
  camera: {
    position: THREE.Vector3;
    target: THREE.Vector3;
    up: THREE.Vector3;
    fov: number;
  };
  /** Device UUIDs resolved from the BCF selection (via deviceGuidMap). */
  selectionDeviceIds: string[];
  /** IFC element expressIDs resolved from the BCF selection (via guidIndex). */
  selectionExpressIds: ExpressId[];
  /**
   * ExpressIDs that should be hidden after applying the viewpoint.
   * Derived from the BCF Components.Visibility block:
   *   - defaultVisibility=true  → exceptions are elements to HIDE (hide them, show rest)
   *   - defaultVisibility=false → exceptions are elements to SHOW (hide everything else)
   */
  hiddenExpressIds: ExpressId[];
}

/**
 * Apply a BCF viewpoint to the current viewport.
 *
 * @param vp             BCF 2.1 viewpoint (camera + components).
 * @param frame          Model frame (recenter + upConversion).
 * @param guidIndex      IFC GlobalId (22-char base-64) → expressID map.
 * @param deviceGuidMap  IFC GlobalId → device UUID map (for device GUID resolution).
 */
export function applyViewpoint(
  vp: { camera: any; components: any },
  frame: ParsedModel['frame'],
  guidIndex: Map<string, ExpressId>,
  deviceGuidMap: Map<string, string>,
): ResolvedViewpoint {
  const { camera, components } = vp;

  // Convert BCF (IFC native, Z-up) camera position to Y-up world space.
  const position = toViewport(
    { x: camera.position[0], y: camera.position[1], z: camera.position[2] },
    frame,
  );

  // Convert direction and up as rotation-only (no translation).
  const dir = toViewportDir(
    { x: camera.direction[0], y: camera.direction[1], z: camera.direction[2] },
    frame,
  );
  const up = toViewportDir({ x: camera.up[0], y: camera.up[1], z: camera.up[2] }, frame);

  // Split component selection GUIDs into devices and IFC elements.
  const sel = (components.selection as string[]) ?? [];
  const selectionDeviceIds: string[] = [];
  const selectionExpressIds: ExpressId[] = [];
  for (const g of sel) {
    const dev = deviceGuidMap.get(g);
    if (dev !== undefined) {
      selectionDeviceIds.push(dev);
    } else {
      const e = guidIndex.get(g);
      if (e != null) selectionExpressIds.push(e);
    }
  }

  // BCF visibility semantics:
  //   defaultVisibility=true  → show everything except exceptions (exceptions are hidden)
  //   defaultVisibility=false → hide everything except exceptions (only exceptions visible)
  const vis = components.visibility;
  let hiddenExpressIds: ExpressId[];
  if (vis.defaultVisibility) {
    // Normal case: hide only the exception elements.
    hiddenExpressIds = (vis.exceptions as string[])
      .map((g: string) => guidIndex.get(g))
      .filter((e): e is ExpressId => e != null);
  } else {
    // Hide-all case: hide every element that is NOT in the exceptions list.
    const keepSet = new Set(
      (vis.exceptions as string[])
        .map((g: string) => guidIndex.get(g))
        .filter((e): e is ExpressId => e != null),
    );
    hiddenExpressIds = [...guidIndex.values()].filter((e) => !keepSet.has(e));
  }

  return {
    camera: {
      position,
      target: position.clone().add(dir),
      up,
      fov: camera.fieldOfView ?? 50,
    },
    selectionDeviceIds,
    selectionExpressIds,
    hiddenExpressIds,
  };
}
