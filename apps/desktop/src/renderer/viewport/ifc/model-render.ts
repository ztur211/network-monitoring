import * as THREE from 'three';
import './bvh-setup'; // patches computeBoundsTree/disposeBoundsTree/acceleratedRaycast onto THREE
import type { MeshBVH } from 'three-mesh-bvh';
import { buildVisibleIndex, sliceElementGeometry, faceIndexToExpressId } from './merge';
import type { MergedCategory } from './merge';
import { isElementVisible } from '../interaction/visibility';
import type { CategoryRender, ElementRef, ExpressId, IfcType, ModelRender, VisibilityState } from './ifc-types';

const HIGHLIGHT = 0x3366ff;

export function createModelRender(merged: MergedCategory[]): ModelRender {
  const categories = new Map<IfcType, CategoryRender>();
  const elementIndex = new Map<ExpressId, ElementRef>();
  const meshes: THREE.Mesh[] = [];

  for (const m of merged) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(m.position, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(m.normal, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(m.color, 3));
    geom.setIndex(new THREE.BufferAttribute(m.index, 1));

    let pickBVH: MeshBVH | null = null;
    if (m.index.length > 0) {
      // indirect:true is REQUIRED — a non-indirect build reorders geometry.index in place, and that
      // array is aliased as cat.fullIndex. Reordering would desync fullIndex from cat.ranges, breaking
      // faceIndexToExpressId (picking) and buildVisibleIndex (visibility). Indirect keeps the index in
      // concat order and stores the permutation inside the BVH, so raycast faceIndex stays original-order.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      geom.computeBoundsTree({ indirect: true } as any);
      pickBVH = (geom as unknown as { boundsTree: MeshBVH }).boundsTree;
    }

    const mesh = new THREE.Mesh(
      geom,
      new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    );
    mesh.userData = { ifcType: m.ifcType };
    mesh.visible = m.index.length > 0;

    const cat: CategoryRender = { ifcType: m.ifcType, mesh, fullIndex: m.index, ranges: m.ranges, pickBVH };
    categories.set(m.ifcType, cat);
    meshes.push(mesh);
    for (const r of m.ranges) {
      elementIndex.set(r.expressID, {
        mesh,
        ifcType: m.ifcType,
        indexStart: r.indexStart,
        indexCount: r.indexCount,
      });
    }
  }

  const overlay = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshLambertMaterial({
      color: 0xffffff,
      emissive: HIGHLIGHT,
      vertexColors: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  overlay.visible = false;
  overlay.userData = { overlay: true };
  meshes.push(overlay);

  function applyVisibility(state: VisibilityState): void {
    for (const cat of categories.values()) {
      if (state.hiddenCategories.has(cat.ifcType)) {
        cat.mesh.visible = false;
        continue;
      }
      const vi = buildVisibleIndex(cat.fullIndex, cat.ranges, (id) => isElementVisible(id, cat.ifcType, state));
      if (vi === 'none') {
        cat.mesh.visible = false;
        continue;
      }
      cat.mesh.visible = true;
      const geom = cat.mesh.geometry as THREE.BufferGeometry;
      const want = vi === 'all' ? cat.fullIndex : vi;
      const cur = geom.getIndex();
      // pick() raycasts the BVH over cat.fullIndex, never this swapped render index — so replacing the
      // render index with a visible subset here cannot corrupt picking.
      if (!cur || cur.array !== want) {
        // BufferAttribute has no public dispose hook. BufferGeometry.dispose() is Three's public
        // signal for the renderer to remove the CURRENT index and attributes from its WebGL cache;
        // without it, replacing the index strands the old GPU buffer until renderer teardown.
        geom.dispose();
        geom.setIndex(new THREE.BufferAttribute(want, 1));
      }
    }
  }

  function applyHighlight(expressID: ExpressId | null): void {
    if (expressID === null) {
      overlay.visible = false;
      return;
    }
    const ref = elementIndex.get(expressID);
    if (!ref || !ref.mesh || ref.indexCount === 0) {
      overlay.visible = false;
      return;
    }
    const cat = categories.get(ref.ifcType)!;
    const g = cat.mesh.geometry as THREE.BufferGeometry;
    // slice by cat.fullIndex (the stable full index), not the live render index, which may be a subset.
    const sliced = sliceElementGeometry(
      {
        position: g.getAttribute('position').array as Float32Array,
        normal: g.getAttribute('normal').array as Float32Array,
        color: g.getAttribute('color').array as Float32Array,
        index: cat.fullIndex,
      },
      ref.indexStart,
      ref.indexCount,
    );
    (overlay.geometry as THREE.BufferGeometry).dispose();
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(sliced.position, 3));
    ng.setAttribute('normal', new THREE.Float32BufferAttribute(sliced.normal, 3));
    ng.setAttribute('color', new THREE.Float32BufferAttribute(sliced.color, 3));
    ng.setIndex(new THREE.BufferAttribute(sliced.index, 1));
    overlay.geometry = ng;
    overlay.visible = true;
  }

  // Nearest VISIBLE element under the ray. All category meshes share one rigid, uniform world
  // matrix (same recenter group), so local hit distances compare directly. The hit point is
  // returned in WORLD space (transformed by the category mesh's world matrix).
  function pick(ray: THREE.Raycaster, vis: VisibilityState): { expressID: ExpressId; point: THREE.Vector3 } | null {
    const localRay = new THREE.Ray();
    const inv = new THREE.Matrix4();
    let best: { expressID: ExpressId; dist: number; point: THREE.Vector3 } | null = null;
    for (const cat of categories.values()) {
      if (!cat.pickBVH || !cat.mesh.visible) continue;
      inv.copy(cat.mesh.matrixWorld).invert();
      localRay.copy(ray.ray).applyMatrix4(inv);
      const hits = cat.pickBVH.raycast(localRay, THREE.DoubleSide);
      for (const h of hits) {
        const id = faceIndexToExpressId(cat.ranges, h.faceIndex as number);
        if (id === null || !isElementVisible(id, cat.ifcType, vis)) continue;
        if (!best || h.distance < best.dist) {
          best = { expressID: id, dist: h.distance, point: h.point.clone().applyMatrix4(cat.mesh.matrixWorld) };
        }
      }
    }
    return best ? { expressID: best.expressID, point: best.point } : null;
  }

  // World-space bbox of one element, computed from its vertex range.
  function elementBox(expressID: ExpressId): THREE.Box3 | null {
    const ref = elementIndex.get(expressID);
    if (!ref || !ref.mesh || ref.indexCount === 0) return null;
    const cat = categories.get(ref.ifcType)!;
    const pos = (cat.mesh.geometry as THREE.BufferGeometry).getAttribute('position');
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < ref.indexCount; i++) {
      v.fromBufferAttribute(pos, cat.fullIndex[ref.indexStart + i]);
      box.expandByPoint(v);
    }
    return box.applyMatrix4(cat.mesh.matrixWorld);
  }

  function dispose(): void {
    for (const cat of categories.values()) {
      const g = cat.mesh.geometry as THREE.BufferGeometry & { disposeBoundsTree?: () => void };
      g.disposeBoundsTree?.();
      g.dispose();
      // deleteAttribute is load-bearing: ifc-model-loader.spec asserts attributes.position is
      // undefined after dispose (the original per-element loader did this too). dispose() frees
      // GPU buffers but does NOT remove the attribute objects, so delete them explicitly.
      g.deleteAttribute('position');
      g.deleteAttribute('normal');
      g.deleteAttribute('color');
      (cat.mesh.material as THREE.Material).dispose();
    }
    (overlay.geometry as THREE.BufferGeometry).dispose();
    (overlay.material as THREE.Material).dispose();
    categories.clear();
    elementIndex.clear();
  }

  return { categories, meshes, overlay, elementIndex, applyVisibility, applyHighlight, pick, elementBox, dispose };
}
