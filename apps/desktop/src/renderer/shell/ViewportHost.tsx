import { useRef } from 'react';
import { useViewportStore } from '../stores/viewport-store';
import { useViewportLoader } from '../viewport/use-viewport-loader';
import { useModelRealtime } from '../viewport/use-model-realtime';
import { useDeviceLoad } from '../viewport/use-device-load';
import { Idle, Loading, Empty, ErrorState, UpdateBanner } from '../viewport/ui/overlays';
import { ViewportCanvas } from '../viewport/scene/ViewportCanvas';
import { Toolbar } from '../viewport/ui/Toolbar';
import { ImportModelButton } from '../viewport/ui/ImportModelButton';
import { Inspector } from '../viewport/ui/Inspector';
import { NodePanel } from '../viewport/ui/NodePanel';
import { IssuesPanel } from '../viewport/bcf/ui/IssuesPanel';
import { OpsHud } from '../viewport/ui/OpsHud';
import { createWorkerIfcModelLoader } from '../viewport/ifc/ifc-worker-model-loader';
import type { IfcModelLoader } from '../viewport/ifc/ifc-types';

export function ViewportHost() {
  // Stable loader identity across re-renders — a fresh identity each render would
  // retrigger the loader effect and cause a React #185-style update loop.
  const loaderRef = useRef<IfcModelLoader | null>(null);
  loaderRef.current ??= createWorkerIfcModelLoader();
  useViewportLoader(loaderRef.current);
  useModelRealtime();
  useDeviceLoad();
  const { status, error, model, updateAvailable, reload } = useViewportStore();

  return (
    <main aria-label="viewport" style={{ position: 'relative', flex: 1 }}>
      {status === 'idle' && <Idle />}
      {status === 'loading' && <Loading />}
      {status === 'parsing' && <Loading parsing />}
      {status === 'empty' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <Empty />
          <ImportModelButton label="Import an IFC model" />
        </div>
      )}
      {status === 'error' && <ErrorState message={error ?? 'Error'} onRetry={reload} />}
      {status === 'ready' && model && (
        <>
          <ViewportCanvas model={model} />
          <Toolbar />
          <OpsHud />
          <aside
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: 320,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              background: '#23262c',
            }}
          >
            <NodePanel />
            <IssuesPanel />
            <Inspector />
          </aside>
          {updateAvailable && <UpdateBanner onReload={reload} />}
        </>
      )}
    </main>
  );
}
