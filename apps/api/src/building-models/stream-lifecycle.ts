import type { Readable } from 'node:stream';

export interface ResponseLifecycle {
  writableFinished?: boolean;
  once(event: 'close' | 'finish', listener: () => void): unknown;
  removeListener(event: 'close' | 'finish', listener: () => void): unknown;
}

/** Release a download source if the HTTP peer disappears before the response finishes. */
export function bindStreamToResponse(stream: Readable, response: ResponseLifecycle): void {
  let active = true;
  const cleanup = () => {
    if (!active) return;
    active = false;
    response.removeListener('close', onClose);
    response.removeListener('finish', onFinish);
  };
  const onFinish = () => cleanup();
  const onClose = () => {
    if (!response.writableFinished && !stream.destroyed) stream.destroy();
    cleanup();
  };
  response.once('finish', onFinish);
  response.once('close', onClose);
  stream.once('end', cleanup);
  stream.once('close', cleanup);
}
