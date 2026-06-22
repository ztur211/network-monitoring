import * as THREE from 'three';
import { IfcAPI } from 'web-ifc';
import type { ElementPayload } from './element-payload';

/**
 * Extract all geometry elements from an opened IFC model into transferable
 * typed-array payloads. No THREE.BufferGeometry or Mesh objects are created here —
 * only math types (Matrix4, Matrix3, Vector3) are used so this function is safe to
 * call inside a Web Worker.
 *
 * The caller is responsible for calling api.OpenModel() before and api.CloseModel()
 * after (or keeping the model open for subsequent use).
 */
export function extractElements(api: IfcAPI, modelID: number): ElementPayload[] {
  const payloads: ElementPayload[] = [];

  const flat = api.LoadAllGeometry(modelID);
  for (let i = 0; i < flat.size(); i++) {
    const fm = flat.get(i);
    const expressID = fm.expressID as number;
    const ifcType: string = api.GetNameFromTypeCode(api.GetLineType(modelID, expressID));

    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    let base = 0;
    const geoms = fm.geometries;
    for (let j = 0; j < geoms.size(); j++) {
      const placed = geoms.get(j);
      const g = api.GetGeometry(modelID, placed.geometryExpressID);
      const verts = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize()); // [px,py,pz,nx,ny,nz]*
      const indices = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
      const m = new THREE.Matrix4().fromArray(placed.flatTransformation as unknown as number[]);
      const nm = new THREE.Matrix3().getNormalMatrix(m);
      const { x: cr, y: cg, z: cb } = placed.color;
      const n = verts.length / 6;
      const p = new THREE.Vector3();
      const v = new THREE.Vector3();
      for (let k = 0; k < n; k++) {
        p.set(verts[k * 6], verts[k * 6 + 1], verts[k * 6 + 2]).applyMatrix4(m);
        v.set(verts[k * 6 + 3], verts[k * 6 + 4], verts[k * 6 + 5]).applyMatrix3(nm).normalize();
        pos.push(p.x, p.y, p.z);
        nor.push(v.x, v.y, v.z);
        col.push(cr, cg, cb);
      }
      for (let k = 0; k < indices.length; k++) idx.push(indices[k] + base);
      base += n;
      g.delete();
    }
    if (!pos.length) continue;

    // BCF Spec 6: index the IFC GlobalId for viewpoint selection/visibility lookup.
    const lineObj = api.GetLine(modelID, expressID) as any;
    const rawGuid = lineObj?.GlobalId;
    const guid: string | undefined =
      rawGuid == null ? undefined : typeof rawGuid === 'object' && 'value' in rawGuid ? String(rawGuid.value) : String(rawGuid);

    payloads.push({
      expressID,
      ifcType,
      guid,
      position: new Float32Array(pos),
      normal: new Float32Array(nor),
      color: new Float32Array(col),
      index: new Uint32Array(idx),
    });
  }

  return payloads;
}
