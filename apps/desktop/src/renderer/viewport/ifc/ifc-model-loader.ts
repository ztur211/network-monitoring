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
  let initialized = false;
  let closed = false;
  const init = () =>
    (ready ??= (api.SetWasmPath(wasm.path, wasm.absolute), api.Init().then(() => {
      initialized = true;
      if (closed) api.Dispose();
    })));

  async function loadModel(bytes: ArrayBuffer): Promise<ParsedModel> {
    if (closed) throw new Error('IFC loader disposed');
    await init();
    if (closed) throw new Error('IFC loader disposed');
    const modelID = api.OpenModel(new Uint8Array(bytes), { COORDINATE_TO_ORIGIN: false });
    let modelClosed = false;
    const closeModel = () => {
      if (modelClosed) return;
      modelClosed = true;
      try {
        api.CloseModel(modelID);
      } catch {
        /* already closed */
      }
    };

    try {
      const payloads = extractElements(api, modelID);
      return assembleModel(payloads, {
        getProperties: (id: ExpressId) => readProperties(api, modelID, id),
        dispose: closeModel,
      });
    } catch (err) {
      closeModel();
      throw err;
    }
  }

  function dispose(): void {
    if (closed) return;
    closed = true;
    if (initialized) api.Dispose();
  }

  return { loadModel, dispose };
}
