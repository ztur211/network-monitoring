import { useRef, useState } from 'react';
import { useViewportStore } from '../../stores/viewport-store';
import { canConfigure } from '../nodes/can-configure';
import { getClients } from '../../data/clients';
import { importModel, type ImportableFile } from '../ifc/import-model';

/**
 * In-app IFC import. Renders for OWNER/ADMIN only (the upload endpoint is OWNER/ADMIN-gated) and
 * only once a building is active. Picks a .ifc file, uploads it as a new model version, activates
 * it as the live model, and reloads the viewport to show the imported geometry. Used on the empty
 * state (primary CTA) and in the toolbar (replace the model at any time).
 */
export function ImportModelButton({ label = 'Import IFC model' }: { label?: string }) {
  const access = useViewportStore((s) => s.access);
  const propertyId = useViewportStore((s) => s.activeBuildingPropertyId);
  const reload = useViewportStore((s) => s.reload);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UX gate only — the server is the authority (OWNER/ADMIN). No building → nothing to import into.
  if (!canConfigure(access) || !propertyId) return null;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] as ImportableFile | undefined;
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    const rest = getClients()?.rest;
    if (!rest) {
      setError('Not connected');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await importModel(file, { rest, propertyId: propertyId!, reload });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Importing…' : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".ifc"
        aria-label="Import IFC model file"
        style={{ display: 'none' }}
        onChange={onPick}
      />
      {error && (
        <span role="alert" style={{ marginLeft: 8, color: '#e06c75' }}>
          {error}
        </span>
      )}
    </span>
  );
}
