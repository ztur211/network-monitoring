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
 */

import * as THREE from 'three';
import type { ParsedModel, ExpressId } from './ifc-types';
import { toViewport, toViewportDir } from '../nodes/node-coords';

// Local BCF shape — mirrors the server's ParsedViewpoint/BcfCamera/BcfComponents
// without importing the API package.
export interface BcfCamera {
  kind: 'perspective' | 'orthographic';
  position: [number, number, number];
  direction: [number, number, number];
  up: [number, number, number];
  fieldOfView?: number;
  viewToWorldScale?: number;
}

export interface BcfComponents {
  selection: string[]; // IFC GlobalIds
  visibility: {
    defaultVisibility: boolean;
    exceptions: string[]; // IFC GlobalIds
  };
}

export interface BcfViewpointIn {
  camera: BcfCamera;
  components: BcfComponents;
}

/** The result of applying a BCF viewpoint: desired camera state + store mutations. */
export interface AppliedViewpoint {
  /** Camera position in Y-up world space. */
  position: THREE.Vector3;
  /** Camera look-at direction in Y-up world space (unit vector). */
  direction: THREE.Vector3;
  /** Camera up vector in Y-up world space (unit vector). */
  up: THREE.Vector3;
  /**
   * Perspective field-of-view in degrees, or undefined for orthographic /
   * when the viewpoint does not specify one.
   */
  fieldOfView: number | undefined;
  /**
   * ExpressIDs that should become the new selection (BCF Components.Selection).
   * Empty array means clear selection.
   */
  selectedIds: ExpressId[];
  /**
   * ExpressIDs that should be hidden after applying the viewpoint.
   * Derived from the BCF Components.Visibility block:
   *   - defaultVisibility=true  → exceptions are elements to HIDE (hide them, show rest)
   *   - defaultVisibility=false → exceptions are elements to SHOW (hide everything else)
   */
  hiddenIds: ExpressId[];
  /**
   * When true, the caller should first show-all before applying hiddenIds.
   * This is set when defaultVisibility=false (hide-all-except-exceptions semantics).
   */
  hideAll: boolean;
}

/**
 * Apply a BCF viewpoint to the current viewport.
 *
 * @param viewpoint  BCF 2.1 viewpoint (camera + components).
 * @param model      Currently-loaded ParsedModel (provides frame + guidIndex).
 */
export function applyViewpoint(viewpoint: BcfViewpointIn, model: ParsedModel): AppliedViewpoint {
  const { camera, components } = viewpoint;
  const { frame, guidIndex } = model;

  // Convert BCF (IFC native, Z-up) camera vectors to Y-up world space.
  // Positions use the full frame transform (recenter + rotation);
  // direction/up use the rotation-only variant (no translation).
  const [px, py, pz] = camera.position;
  const [dx, dy, dz] = camera.direction;
  const [ux, uy, uz] = camera.up;

  const position = toViewport({ x: px, y: py, z: pz }, frame);
  const direction = toViewportDir({ x: dx, y: dy, z: dz }, frame).normalize();
  const up = toViewportDir({ x: ux, y: uy, z: uz }, frame).normalize();

  // Resolve IFC GlobalIds → expressIDs via the model's guidIndex (unknown GUIDs skipped).
  const resolve = (guids: string[]): ExpressId[] => {
    const ids: ExpressId[] = [];
    for (const g of guids) {
      const id = guidIndex.get(g);
      if (id !== undefined) ids.push(id);
    }
    return ids;
  };

  const selectedIds = resolve(components.selection);

  // BCF visibility semantics:
  //   defaultVisibility=true  → show everything except exceptions (exceptions are hidden)
  //   defaultVisibility=false → hide everything except exceptions (only exceptions visible)
  const { defaultVisibility, exceptions } = components.visibility;
  const exceptionIds = resolve(exceptions);

  let hiddenIds: ExpressId[];
  let hideAll: boolean;
  if (defaultVisibility) {
    // Normal case: hide only the exception elements.
    hiddenIds = exceptionIds;
    hideAll = false;
  } else {
    // Hide-all case: hide every element that is NOT in the exceptions list.
    const keep = new Set(exceptionIds);
    hiddenIds = [...model.elementIndex.keys()].filter((id) => !keep.has(id));
    hideAll = true;
  }

  return { position, direction, up, fieldOfView: camera.kind === 'perspective' ? camera.fieldOfView : undefined, selectedIds, hiddenIds, hideAll };
}
