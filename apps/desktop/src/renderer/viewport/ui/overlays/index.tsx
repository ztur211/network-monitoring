export const Idle = () => <div role="status">Select a building to view its model.</div>;

export const Loading = ({ parsing = false }: { parsing?: boolean }) => (
  <div role="status">{parsing ? 'Opening model…' : 'Downloading model…'}</div>
);

export const Empty = () => (
  <div role="status">No 3D model has been uploaded for this building yet.</div>
);

export const ErrorState = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <div role="alert">
    {message} <button onClick={onRetry}>Retry</button>
  </div>
);

export const UpdateBanner = ({ onReload }: { onReload: () => void }) => (
  <div role="status">
    Model updated <button onClick={onReload}>Reload</button>
  </div>
);
