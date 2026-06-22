import { IfcAPI } from 'web-ifc';
import type {
  ParsedModel,
  IfcModelLoader,
  ExpressId,
} from './ifc-types';
import { defaultWasmPath } from './wasm-path';
import { extractElements } from './extract-elements';
import { assembleModel } from './scene-assembly';
import { readProperties } from './read-properties';
export { readProperties, asText } from './read-properties';

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

