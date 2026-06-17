import { useViewportStore } from '../stores/viewport-store';
import { useViewportLoader } from '../viewport/use-viewport-loader';
import { useModelRealtime } from '../viewport/use-model-realtime';
import { Idle, Loading, Empty, ErrorState, UpdateBanner } from '../viewport/ui/overlays';
import { ViewportCanvas } from '../viewport/scene/ViewportCanvas';
import { Toolbar } from '../viewport/ui/Toolbar';
import { Inspector } from '../viewport/ui/Inspector';

export function ViewportHost() {
  useViewportLoader();
  useModelRealtime();
  const { status, error, model, updateAvailable, reload } = useViewportStore();

  return (
    <main aria-label="viewport" style={{ position: 'relative', flex: 1 }}>
      {status === 'idle' && <Idle />}
      {status === 'loading' && <Loading />}
      {status === 'parsing' && <Loading parsing />}
      {status === 'empty' && <Empty />}
      {status === 'error' && <ErrorState message={error ?? 'Error'} onRetry={reload} />}
      {status === 'ready' && model && (
        <>
          <ViewportCanvas model={model} />
          <Toolbar />
          <Inspector />
          {updateAvailable && <UpdateBanner onReload={reload} />}
        </>
      )}
    </main>
  );
}
