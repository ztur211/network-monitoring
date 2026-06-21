import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// Accelerate raycasting (picking + placement) with a per-geometry BVH. Patch THREE's
// prototypes once at import; a geometry opts in by calling computeBoundsTree() (the IFC
// loader does), after which Mesh.raycast walks the BVH instead of brute-forcing every
// triangle of every visible element on each click.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
