/**
 * BCF Spec 6 Phase D — capture-viewpoint
 *
 * Converts the current viewport camera + store visibility/selection state into
 * a BCF 2.1 viewpoint payload ready to POST to the server.
 *
 * All BCF camera vectors are in IFC native space (Z-up, pre-recentered). We
 * convert from the viewer's Y-up world space using the model's frame.
 *
 * Pure function — no side-effects. Returns the BcfViewpointIn shape that the
 * API's BcfService expects (same shape as apply-viewpoint's input).
 */

import * as THREE from 'three';
import type { ParsedModel, ExpressId } from './ifc-types';
import { toModelDir } from '../nodes/node-coords';
import type { BcfCamera, BcfComponents, BcfViewpointIn } from './apply-viewpoint';

export type { BcfCamera, BcfComponents, BcfViewpointIn };

/** The viewport camera state needed to capture a viewpoint. */
export interface CameraState {
  /** Camera world position (Y-up). */
  position: THREE.Vector3;
  /** Normalized look-at direction (Y-up). */
  direction: THREE.Vector3;
  /** Normalized up vector (Y-up). */
  up: THREE.Vector3;
  /** Perspective field-of-view in degrees (ignored for orthographic). */
  fov?: number;
  /** Camera projection mode. Defaults to 'perspective'. */
  kind?: 'perspective' | 'orthographic';
}

/** The viewport store selection/visibility state needed to capture a viewpoint. */
export interface ViewportVisibility {
  /** Currently selected element's expressID, or null. */
  selectedElementId: ExpressId | null;
  /** Set of element expressIDs that are currently hidden. */
  hiddenElements: Set<ExpressId>;
}

/**
 * Capture the current viewport state as a BCF 2.1 viewpoint.
 *
 * @param camera      Current Three.js camera state in Y-up world space.
 * @param visibility  Current selection/visibility from the viewport store.
 * @param model       Currently-loaded ParsedModel (provides frame + guidIndex for reverse-lookup).
 * @param guid        UUID string to use as the viewpoint GUID.
 */
export function captureViewpoint(
  camera: CameraState,
  visibility: ViewportVisibility,
  model: ParsedModel,
  guid: string,
): BcfViewpointIn & { guid: string } {
  const { frame, guidIndex } = model;
  const kind = camera.kind ?? 'perspective';

  // Convert Y-up viewport position → IFC native Z-up.
  // toViewport is M = Rx(-90°)·T(-recenter); its inverse is T(recenter)·Rx(+90°).
  // For position we need the inverse of toViewport.
  // toModelDir handles the rotation-only inverse; for position we apply it manually.
  const rotInv = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  const recenter = frame.recenter;

  const nativePosition = camera.position.clone().applyMatrix4(rotInv);
  nativePosition.add(recenter);

  const nativeDirection = toModelDir(camera.direction.clone(), frame);
  const nativeUp = toModelDir(camera.up.clone(), frame);

  // Build a reverse map from expressID → IFC GlobalId using the model's guidIndex.
  const expressToGuid = new Map<ExpressId, string>();
  for (const [g, id] of guidIndex) {
    expressToGuid.set(id, g);
  }

  // BCF Components.Selection: selected element only (if it has a known GlobalId).
  const selectionGuids: string[] = [];
  if (visibility.selectedElementId !== null) {
    const g = expressToGuid.get(visibility.selectedElementId);
    if (g !== undefined) selectionGuids.push(g);
  }

  // BCF Components.Visibility:
  // defaultVisibility=true + exceptions = hidden elements (standard case).
  // We always use defaultVisibility=true; hidden elements become exceptions.
  const hiddenGuids: string[] = [];
  for (const id of visibility.hiddenElements) {
    const g = expressToGuid.get(id);
    if (g !== undefined) hiddenGuids.push(g);
  }

  const bcfCamera: BcfCamera = {
    kind,
    position: [nativePosition.x, nativePosition.y, nativePosition.z],
    direction: [nativeDirection.x, nativeDirection.y, nativeDirection.z],
    up: [nativeUp.x, nativeUp.y, nativeUp.z],
    ...(kind === 'perspective' && camera.fov !== undefined ? { fieldOfView: camera.fov } : {}),
  };

  const components: BcfComponents = {
    selection: selectionGuids,
    visibility: {
      defaultVisibility: true,
      exceptions: hiddenGuids,
    },
  };

  return { guid, camera: bcfCamera, components };
}
