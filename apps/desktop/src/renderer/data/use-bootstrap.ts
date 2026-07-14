import { useEffect } from 'react';
import { WS_EVENTS } from '@nodescope/shared';
import { useAuthStore } from '../stores/auth-store';
import { useSitesStore } from '../stores/sites-store';
import { buildClients, setClients, getClients } from './clients';

type Clients = Awaited<ReturnType<typeof buildClients>>;

const PROPERTY_EVENTS = [
  WS_EVENTS.PROPERTY_CREATED,
  WS_EVENTS.PROPERTY_UPDATED,
  WS_EVENTS.PROPERTY_DELETED,
  WS_EVENTS.PROPERTY_MOVED,
];

// Load the org + property tree into the stores and connect realtime; refresh the tree on
// any property lifecycle event (kept simple: re-fetch the list).
// Returns a teardown that unsubscribes and closes the socket, so the caller can drop the client.
export async function bootstrap(clients: Clients): Promise<() => void> {
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
  for (const evt of PROPERTY_EVENTS) {
    clients.realtime.on(evt, refresh);
  }

  return () => {
    for (const evt of PROPERTY_EVENTS) {
      clients.realtime.off(evt, refresh);
    }
    clients.realtime.disconnect();
    // Only retract the shared pointer if it still points at us: a late teardown of a superseded
    // client must not unset the client a newer bootstrap has already published.
    if (getClients() === clients) setClients(null);
  };
}

/** React hook: bootstrap whenever auth flips true, and tear the clients down when it flips false. */
export function useBootstrap(): void {
  const authed = useAuthStore((s) => s.authed);
  useEffect(() => {
    if (!authed) return;

    let cancelled = false;
    let teardown: (() => void) | null = null;

    buildClients()
      .then(bootstrap)
      .then((dispose) => {
        // buildClients()/bootstrap() are async, so auth can flip back to false (logout) while they
        // are still resolving - by then this effect's cleanup has already run and will never see
        // the client. Dispose of it here instead of leaving a connected socket nobody can reach:
        // it holds 4 live property listeners and reconnects forever (attempts default to Infinity).
        if (cancelled) dispose();
        else teardown = dispose;
      })
      .catch(() => {
        /* surfaced via re-auth */
      });

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [authed]);
}
