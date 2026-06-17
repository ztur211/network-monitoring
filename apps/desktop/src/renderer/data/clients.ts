import { createRestClient, createRealtimeClient } from '@nodescope/client';

// Build the REST + realtime clients from the preload bridge (API base URL + token provider).
export async function buildClients() {
  const { apiUrl } = await window.nodescope.app.getConfig();
  const getToken = () => window.nodescope.auth.getToken();
  return {
    rest: createRestClient({ baseUrl: apiUrl, getToken }),
    realtime: createRealtimeClient({ baseUrl: apiUrl, getToken }),
  };
}
