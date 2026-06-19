import * as THREE from 'three';
import { IfcAPI } from 'web-ifc';
import type {
  ParsedModel,
  IfcModelLoader,
  ExpressId,
  IfcType,
  ElementProperties,
  PropertySet,
  PropertyEntry,
} from './ifc-types';
import { defaultWasmPath } from './wasm-path';

export interface LoaderOpts {
  wasmPath?: { path: string; absolute: boolean };
}

export function createIfcModelLoader(opts: LoaderOpts = {}): IfcModelLoader {
  const wasm = opts.wasmPath ?? defaultWasmPath();
  const api = new IfcAPI();
  let ready: Promise<void> | null = null;
  const init = () => (ready ??= (api.SetWasmPath(wasm.path, wasm.absolute), api.Init()));

  async function loadModel(bytes: ArrayBuffer): Promise<ParsedModel> {
    await init();
    const modelID = api.OpenModel(new Uint8Array(bytes), { COORDINATE_TO_ORIGIN: false });

    const root = new THREE.Group();
    const recenterGroup = new THREE.Group(); // meshes in native frame; offset after bbox
    root.add(recenterGroup);
    const categories = new Map<IfcType, THREE.Group>();
    const elementIndex = new Map<ExpressId, THREE.Mesh>();
    const guidIndex = new Map<string, ExpressId>(); // BCF Spec 6: IFC GlobalId → expressID

    const flat = api.LoadAllGeometry(modelID);
    for (let i = 0; i < flat.size(); i++) {
      const fm = flat.get(i);
      const expressID = fm.expressID as ExpressId;
      const ifcType: IfcType = api.GetNameFromTypeCode(api.GetLineType(modelID, expressID));

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
      if (guid) guidIndex.set(guid, expressID);

      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      bg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      bg.setIndex(idx);
      const mesh = new THREE.Mesh(
        bg,
        new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      );
      mesh.userData = { expressID, ifcType };

      let group = categories.get(ifcType);
      if (!group) {
        group = new THREE.Group();
        group.name = ifcType;
        categories.set(ifcType, group);
        recenterGroup.add(group);
      }
      group.add(mesh);
      elementIndex.set(expressID, mesh);
    }

    // recenter (native frame) then convert Z-up → Y-up on root
    const nativeBox = new THREE.Box3().setFromObject(recenterGroup);
    const recenter = nativeBox.getCenter(new THREE.Vector3());
    recenterGroup.position.set(-recenter.x, -recenter.y, -recenter.z);
    root.rotation.x = -Math.PI / 2;
    root.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(root);

    async function getProperties(expressID: ExpressId): Promise<ElementProperties> {
      return readProperties(api, modelID, expressID);
    }
    function dispose(): void {
      for (const mesh of elementIndex.values()) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        mesh.geometry.deleteAttribute('position');
        mesh.geometry.deleteAttribute('normal');
        mesh.geometry.deleteAttribute('color');
      }
      elementIndex.clear();
      categories.clear();
      try {
        api.CloseModel(modelID);
      } catch {
        /* already closed */
      }
    }

    return {
      root,
      categories,
      elementIndex,
      guidIndex,
      bbox,
      frame: { recenter, upConversion: 'Z_UP_TO_Y_UP' },
      getProperties,
      dispose,
    };
  }

  return { loadModel };
}

function asText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'object' && 'value' in v) return String((v as { value: unknown }).value);
  return String(v);
}

async function readProperties(
  api: IfcAPI,
  modelID: number,
  expressID: number,
): Promise<ElementProperties> {
  const ifcType = api.GetNameFromTypeCode(api.GetLineType(modelID, expressID));
  const line = api.GetLine(modelID, expressID) as any; // web-ifc line object (dynamic attributes)
  const name = line?.Name ? asText(line.Name) : null;
  const tag = line?.Tag ? asText(line.Tag) : null;

  const sets: PropertySet[] = [];
  // getPropertySets(..., true) inlines the IfcPropertySet handles + their properties.
  const psets: any[] = await (api.properties as any).getPropertySets(modelID, expressID, true);
  for (const ps of psets) {
    const props: PropertyEntry[] = [];
    for (const prop of ps.HasProperties ?? []) {
      const p = typeof prop?.value === 'number' ? (api.GetLine(modelID, prop.value) as any) : prop;
      if (p?.Name) props.push({ name: asText(p.Name), value: asText(p.NominalValue ?? p.Value ?? '') });
    }
    sets.push({ name: ps?.Name ? asText(ps.Name) : 'PropertySet', props });
  }
  return { expressID, ifcType, name, tag, propertySets: sets };
}
