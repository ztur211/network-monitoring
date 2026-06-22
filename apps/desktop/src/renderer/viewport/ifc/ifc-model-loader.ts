import { IfcAPI } from 'web-ifc';
import type {
  ParsedModel,
  IfcModelLoader,
  ExpressId,
  ElementProperties,
  PropertySet,
  PropertyEntry,
} from './ifc-types';
import { defaultWasmPath } from './wasm-path';
import { extractElements } from './extract-elements';
import { assembleModel } from './scene-assembly';

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

    const payloads = extractElements(api, modelID);

    return assembleModel(payloads, {
      getProperties: (id: ExpressId) => readProperties(api, modelID, id),
      dispose: () => {
        try {
          api.CloseModel(modelID);
        } catch {
          /* already closed */
        }
      },
    });
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
