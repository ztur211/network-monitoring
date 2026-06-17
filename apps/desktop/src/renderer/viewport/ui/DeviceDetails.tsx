import { useViewportStore } from '../../stores/viewport-store';
import { canConfigure } from '../nodes/can-configure';
import { clearPlacement } from '../nodes/placement';
import { getClients } from '../../data/clients';

const isPlaced = (d: { x: number | null }) => d.x !== null;

/** The device branch of the Inspector: fields + F3-gated Place/Move/Clear/Zoom. Configure actions render
 *  only for OWNER/ADMIN (`canConfigure`); MEMBER is view-only. The server is the authority regardless. */
export function DeviceDetails() {
  const { devices, selection, access, beginPlace, requestFocus, nodeStatus } = useViewportStore();
  if (selection?.kind !== 'device') return null;
  const d = devices.find((x) => x.id === selection.deviceId);
  if (!d) return null;
  const mayConfigure = canConfigure(access);
  const placed = isPlaced(d);

  const clear = () => {
    const clients = getClients();
    if (clients) void clearPlacement(d.id, { rest: clients.rest as never });
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
      </dl>
      <div>
        {placed && <button onClick={() => requestFocus()}>Zoom to</button>}
        {mayConfigure && !placed && <button onClick={() => beginPlace(d.id)}>Place</button>}
        {mayConfigure && placed && <button onClick={() => beginPlace(d.id)}>Move</button>}
        {mayConfigure && placed && <button onClick={clear}>Clear</button>}
      </div>
    </aside>
  );
}
