import { useEffect } from 'react';
import { WS_EVENTS } from '@nodescope/shared';
import { useViewportStore } from '../stores/viewport-store';
import { getClients } from '../data/clients';

// For the open building: model activate/version-upload raises a non-intrusive "reload" flag (no
// auto-reload mid-inspection); delete reverts to the empty state.
export function useModelRealtime() {
  const propertyId = useViewportStore((s) => s.activeBuildingPropertyId);
  useEffect(() => {
    const rt = getClients()?.realtime;
    if (!rt || !propertyId) return;
    const isMine = (p: { propertyId?: string }) => p?.propertyId === propertyId;
    const onChange = (p: any) => {
      if (isMine(p)) useViewportStore.getState().flagUpdate();
    };
    const onDelete = (p: any) => {
      if (isMine(p)) useViewportStore.getState()._setStatus('empty');
    };
    rt.on(WS_EVENTS.BUILDING_MODEL_ACTIVATED, onChange);
    rt.on(WS_EVENTS.BUILDING_MODEL_VERSION_UPLOADED, onChange);
    rt.on(WS_EVENTS.BUILDING_MODEL_DELETED, onDelete);
    return () => {
      rt.off?.(WS_EVENTS.BUILDING_MODEL_ACTIVATED, onChange);
      rt.off?.(WS_EVENTS.BUILDING_MODEL_VERSION_UPLOADED, onChange);
      rt.off?.(WS_EVENTS.BUILDING_MODEL_DELETED, onDelete);
    };
  }, [propertyId]);
}
