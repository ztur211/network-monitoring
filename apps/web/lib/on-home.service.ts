// Subscribes the network store to the server's `v1:network:onHome:changed`
// pushes. The gateway emits one event on socket connect (current truth) and
// then again only if the user actively saves a new home IP — it's not a
// continuous feed. Mirrors the structure of `subscribeToMetricsUpdates`.
import { WS_EVENTS } from '@nodescope/shared';
import { websocketService } from './websocket.service';
import { useNetworkStore } from '../store/network.store';

interface OnHomeChangedPayload {
  networkId: string | null;
  onHome: boolean;
}

export function subscribeToOnHomeUpdates(): () => void {
  const handler = (data: OnHomeChangedPayload): void => {
    useNetworkStore.getState().setOnHome(data.onHome);
  };
  websocketService.on(WS_EVENTS.NETWORK_ON_HOME_CHANGED, handler);
  return () =>
    websocketService.off(
      WS_EVENTS.NETWORK_ON_HOME_CHANGED,
      handler as (...args: unknown[]) => void,
    );
}
