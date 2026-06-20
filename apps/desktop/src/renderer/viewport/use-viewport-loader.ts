import { useEffect, useRef } from 'react';
import type { ParsedModel, IfcModelLoader } from './ifc/ifc-types';
import { createIfcModelLoader } from './ifc/ifc-model-loader';
import { useViewportStore, type ViewportStatus } from '../stores/viewport-store';
import { getClients } from '../data/clients';

interface RestLike {
  getBuildingModel(id: string): Promise<unknown>;
  getActiveModelFile(id: string): Promise<ArrayBuffer>;
}
export interface ModelCache {
  put(id: string, model: ParsedModel): void;
  take(id: string): ParsedModel | null;
  clear(id?: string): void;
}

// keep-last-1: putting a different model evicts (and disposes) the previous one.
export function createModelCache(): ModelCache {
  let entry: { id: string; model: ParsedModel } | null = null;
  return {
    put(id, model) {
      if (entry && entry.id !== id) entry.model.dispose();
      if (entry?.id === id && entry.model !== model) entry.model.dispose();
      entry = { id, model };
    },
    take(id) {
      if (entry?.id === id) {
        const m = entry.model;
        entry = null;
        return m;
      }
      return null;
    },
    clear(id) {
      if (!id || entry?.id === id) {
        entry?.model.dispose();
        entry = null;
      }
    },
  };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Unexpected error');
const codeOf = (e: unknown) => (e as { code?: string })?.code;

export async function loadBuilding(opts: {
  propertyId: string;
  rest: RestLike;
  loader: IfcModelLoader;
  cache: ModelCache;
  isCurrent: () => boolean;
  setStatus: (s: string, error?: string | null) => void;
  setModel: (m: ParsedModel | null) => void;
}): Promise<void> {
  const { propertyId, rest, loader, cache, isCurrent, setStatus, setModel } = opts;
  setStatus('loading');

  const cached = cache.take(propertyId);
  if (cached) {
    if (!isCurrent()) {
      cache.put(propertyId, cached);
      return;
    }
    setModel(cached);
    setStatus('ready');
    return;
  }

  try {
    await rest.getBuildingModel(propertyId);
  } catch (e) {
    if (!isCurrent()) return;
    if (codeOf(e) === 'MODEL_001') setStatus('empty');
    else setStatus('error', errText(e));
    return;
  }
  if (!isCurrent()) return;

  let bytes: ArrayBuffer;
  try {
    bytes = await rest.getActiveModelFile(propertyId);
  } catch (e) {
    if (isCurrent()) setStatus('error', errText(e));
    return;
  }
  if (!isCurrent()) return;

  setStatus('parsing');
  let model: ParsedModel;
  try {
    model = await loader.loadModel(bytes);
  } catch {
    if (isCurrent()) setStatus('error', "Couldn't open this model");
    return;
  }
  if (!isCurrent()) {
    model.dispose();
    return;
  }
  setModel(model);
  setStatus('ready');
}

/** Wires loadBuilding to the active building + reloadNonce, stashing the prior model in a keep-last-1 cache. */
export function useViewportLoader(loaderArg?: IfcModelLoader) {
  // Create the default loader ONCE (not as a default param, which runs every render):
  // a fresh loader identity in the effect deps below would retrigger the effect on every
  // render → setState → re-render → infinite update loop (React #185).
  const fallbackRef = useRef<IfcModelLoader | null>(null);
  fallbackRef.current ??= createIfcModelLoader();
  const loader = loaderArg ?? fallbackRef.current;

  const cacheRef = useRef<ModelCache | null>(null);
  cacheRef.current ??= createModelCache();
  const shownRef = useRef<{ id: string; model: ParsedModel } | null>(null);
  const propertyId = useViewportStore((s) => s.activeBuildingPropertyId);
  const nonce = useViewportStore((s) => s.reloadNonce);

  useEffect(() => {
    const store = useViewportStore.getState();
    const cache = cacheRef.current!;
    // stash whatever is currently shown so toggling back is instant
    if (shownRef.current) {
      cache.put(shownRef.current.id, shownRef.current.model);
      shownRef.current = null;
    }
    store._setModel(null);
    if (!propertyId) {
      store._setStatus('idle');
      return;
    }

    let active = true;
    const rest = getClients()?.rest as unknown as RestLike;
    if (!rest) {
      store._setStatus('error', 'Not connected');
      return;
    }

    void loadBuilding({
      propertyId,
      rest,
      loader,
      cache,
      isCurrent: () => active && useViewportStore.getState().activeBuildingPropertyId === propertyId,
      setStatus: (s, e) => store._setStatus(s as ViewportStatus, e),
      setModel: (m) => {
        store._setModel(m);
        if (m) shownRef.current = { id: propertyId, model: m };
      },
    });
    return () => {
      active = false;
    };
  }, [propertyId, nonce, loader]);
}
