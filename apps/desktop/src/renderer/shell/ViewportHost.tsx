import { useViewportStore } from '../stores/viewport-store';
import { useViewportLoader } from '../viewport/use-viewport-loader';
import { useModelRealtime } from '../viewport/use-model-realtime';
import { Idle, Loading, Empty, ErrorState, UpdateBanner } from '../viewport/ui/overlays';

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
      {status === 'ready' && (
        <>
          {/* Phase C replaces this slot with <ViewportCanvas model={model} /> */}
          <div role="status">Model ready — {model?.elementIndex.size ?? 0} elements</div>
          {updateAvailable && <UpdateBanner onReload={reload} />}
        </>
      )}
    </main>
  );
}
