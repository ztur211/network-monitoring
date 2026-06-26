import { createRestClient, createRealtimeClient } from '@nodescope/client';

// Build the REST + realtime clients from the preload bridge (API base URL + token provider).
export async function buildClients() {
  const { apiUrl } = await window.nodescope.app.getConfig();
  const getToken = () => window.nodescope.auth.getToken();
  return {
    rest: createRestClient({ baseUrl: apiUrl, getToken }),
    // Electron uses a websocket-only transport (no browser polling fallback) and bearer-token auth.
    realtime: createRealtimeClient({ baseUrl: apiUrl, getToken, transports: ['websocket'] }),
  };
}

// The built clients, shared with the viewport hooks (set by useBootstrap on auth).
type Clients = Awaited<ReturnType<typeof buildClients>>;
let _clients: Clients | null = null;
export function setClients(c: Clients | null) {
  _clients = c;
}
export function getClients(): Clients | null {
  return _clients;
}
