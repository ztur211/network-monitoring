import type { ResolvedViewpoint } from './apply-viewpoint';
import { useViewportStore } from '../../stores/viewport-store';

export function navigateToViewpoint(r: ResolvedViewpoint): void {
  const s = useViewportStore.getState();

  // Replace hidden set (not additive)
  s.setHiddenElements(new Set(r.hiddenExpressIds));

  // Apply selection: device first, then element, then clear
  if (r.selectionDeviceIds[0]) {
    s.selectNode(r.selectionDeviceIds[0]);
  } else if (r.selectionExpressIds[0] != null) {
    s.selectElement(r.selectionExpressIds[0]);
  } else {
    s.clearSelection();
  }

  // Request camera application via a nonce (consumed by ViewCommands)
  s.setViewpointRequest({
    camera: r.camera,
    nonce: (s.viewpointRequest?.nonce ?? 0) + 1,
  });
}
