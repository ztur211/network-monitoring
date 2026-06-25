import { useViewportStore } from '../../stores/viewport-store';
import { canConfigure } from '../nodes/can-configure';
import { clearPlacement } from '../nodes/placement';
import { clearLink } from '../nodes/link';
import { getClients } from '../../data/clients';

const isPlaced = (d: { x: number | null }) => d.x !== null;

/** The device branch of the Inspector: fields + F3-gated Place/Move/Clear/Zoom and BIM-link actions.
 *  Configure actions render only for OWNER/ADMIN (`canConfigure`); MEMBER is view-only. The server is
 *  the authority regardless. */
export function DeviceDetails() {
  const { devices, selection, access, beginPlace, beginLink, linkingDeviceId, requestFocus, nodeStatus } =
    useViewportStore();
  if (selection?.kind !== 'device') return null;
  const d = devices.find((x) => x.id === selection.deviceId);
  if (!d) return null;
  const mayConfigure = canConfigure(access);
  const placed = isPlaced(d);
  const linking = linkingDeviceId === d.id;

  const clear = () => {
    const clients = getClients();
    if (clients) void clearPlacement(d.id, { rest: clients.rest as never });
  };
  const unlink = () => {
    const clients = getClients();
    if (clients) void clearLink(d.id, { rest: clients.rest as never });
  };

  return (
    <aside aria-label="device-details" style={{ overflow: 'auto' }}>
      <h3>{d.name}</h3>
      <dl>
        <dt>Type</dt>
        <dd>{d.category}</dd>
        <dt>Network</dt>
        <dd>{d.networkId}</dd>
        {d.ipAddress && (
          <>
            <dt>IP</dt>
            <dd>{d.ipAddress}</dd>
          </>
        )}
        <dt>Status</dt>
        <dd>{nodeStatus.get(d.id) ?? 'unknown'}</dd>
        <dt>Position</dt>
        <dd>{placed ? `${d.x!.toFixed(2)}, ${d.y!.toFixed(2)}, ${d.z!.toFixed(2)}` : 'Unplaced'}</dd>
        <dt>BIM object</dt>
        <dd>{d.ifcGlobalId ? `Linked (${d.ifcGlobalId})` : 'Not linked'}</dd>
      </dl>
      <div>
        {placed && <button onClick={() => requestFocus()}>Zoom to</button>}
        {mayConfigure && !placed && <button onClick={() => beginPlace(d.id)}>Place</button>}
        {mayConfigure && placed && <button onClick={() => beginPlace(d.id)}>Move</button>}
        {mayConfigure && placed && <button onClick={clear}>Clear</button>}
        {mayConfigure && !linking && (
          <button onClick={() => beginLink(d.id)}>{d.ifcGlobalId ? 'Re-link BIM object' : 'Link to BIM object'}</button>
        )}
        {mayConfigure && d.ifcGlobalId && <button onClick={unlink}>Unlink</button>}
      </div>
      {linking && (
        <p role="status">
          Click a BIM object to link it (Esc to cancel).{' '}
          <button onClick={() => useViewportStore.getState().cancelLink()}>Cancel</button>
        </p>
      )}
    </aside>
  );
}
