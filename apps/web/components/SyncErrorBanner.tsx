import { Pressable, Text } from 'react-native';
import { useDeviceStore } from '../store/device.store';
import { useCircuitStore } from '../store/circuits.store';

/**
 * Surfaces an offline-replay give-up — a queued mutation that hit a server
 * conflict (409) or exhausted its retry budget and was dropped rather than
 * replayed forever. Without this the drop would be silent, violating the
 * "honest about stale/failed data" principle.
 *
 * Renders while *connected* (that's when replay runs), so it lives outside
 * OfflineBanner, which hides itself when connected. Tap to dismiss.
 */
export function SyncErrorBanner() {
  const deviceError = useDeviceStore((s) => s.offlineSyncError);
  const circuitError = useCircuitStore((s) => s.offlineSyncError);
  const clearDeviceError = useDeviceStore((s) => s.clearOfflineSyncError);
  const clearCircuitError = useCircuitStore((s) => s.clearOfflineSyncError);

  const message = deviceError ?? circuitError;
  if (!message) return null;

  const dismiss = () => {
    clearDeviceError();
    clearCircuitError();
  };

  return (
    <Pressable onPress={dismiss} className="px-4 py-2 bg-amber-600">
      <Text className="text-white text-sm font-medium text-center">
        {message} (tap to dismiss)
      </Text>
    </Pressable>
  );
}
