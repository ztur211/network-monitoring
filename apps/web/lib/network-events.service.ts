// Network-state event subscriptions. Two pushes from the gateway feed the
// network store:
//
//   v1:network:onHome:changed — emitted once on socket connect (current
//     truth) and again when the user saves a new home IP. Not continuous.
//
//   v1:network:updated — emitted on POST/PATCH /networks/:id. Used to
//     refresh the cached NetworkSummary (and pick up the network the
//     wizard just created without forcing a page reload).
import { WS_EVENTS, NetworkDetail, NetworkSummary } from '@nodescope/shared';
import { websocketService } from './websocket.service';
import { useNetworkStore } from '../store/network.store';

interface OnHomeChangedPayload {
  networkId: string | null;
  onHome: boolean;
}

interface NetworkUpdatedPayload {
  networkId: string;
  network: NetworkDetail;
}

export function subscribeToOnHomeUpdates(): () => void {
  return websocketService.subscribe<OnHomeChangedPayload>(
    WS_EVENTS.NETWORK_ON_HOME_CHANGED,
    (data) => {
      useNetworkStore.getState().setOnHome(data.onHome);
    },
  );
}

export function subscribeToNetworkUpdates(): () => void {
  return websocketService.subscribe<NetworkUpdatedPayload>(WS_EVENTS.NETWORK_UPDATED, (data) => {
    // The store holds NetworkSummary (no homePublicIp); strip the field from
    // the wire-shaped detail before caching. List endpoints intentionally
    // omit it too, so this keeps the in-memory shape consistent.
    const { homePublicIp: _homePublicIp, ...summary } = data.network;
    useNetworkStore.getState().setNetwork(summary as NetworkSummary);
  });
}
