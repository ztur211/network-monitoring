import { useEffect } from 'react';
import { WS_EVENTS } from '@nodescope/shared';
import { useAuthStore } from '../stores/auth-store';
import { useSitesStore } from '../stores/sites-store';
import { buildClients, setClients } from './clients';

type Clients = Awaited<ReturnType<typeof buildClients>>;

// Load the org + property tree into the stores and connect realtime; refresh the tree on
// any property lifecycle event (kept simple: re-fetch the list).
export async function bootstrap(clients: Clients): Promise<void> {
  setClients(clients); // expose to the viewport hooks
  const [org, properties] = await Promise.all([
    clients.rest.getOrganization(),
    clients.rest.listProperties(),
  ]);
  useAuthStore.getState().setOrg(org);
  useSitesStore.getState().setProperties(properties);

  await clients.realtime.connect();
  const refresh = () =>
    clients.rest.listProperties().then((p) => useSitesStore.getState().setProperties(p));
  for (const evt of [
    WS_EVENTS.PROPERTY_CREATED,
    WS_EVENTS.PROPERTY_UPDATED,
    WS_EVENTS.PROPERTY_DELETED,
    WS_EVENTS.PROPERTY_MOVED,
  ]) {
    clients.realtime.on(evt, refresh);
  }
}

/** React hook: bootstrap whenever auth flips true. */
export function useBootstrap(): void {
  const authed = useAuthStore((s) => s.authed);
  useEffect(() => {
    if (authed) buildClients().then(bootstrap).catch(() => { /* surfaced via re-auth */ });
  }, [authed]);
}
