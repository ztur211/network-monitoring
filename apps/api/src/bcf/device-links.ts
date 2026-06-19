/**
 * Pure helper: map BCF viewpoint component ifcGuids → matched deviceIds.
 *
 * The device↔IFC key is `toIfcGuid(device.id)` (deterministic UUID→IFC base-64).
 * This function takes the pre-built reverse map (ifcGuid→deviceId) and returns
 * deduplicated deviceIds for every component whose ifcGuid appears in the map.
 */
export function deriveDeviceLinks(
  components: { ifcGuid: string }[],
  deviceGuidMap: Map<string, string>,
): string[] {
  const seen = new Set<string>();
  for (const { ifcGuid } of components) {
    const deviceId = deviceGuidMap.get(ifcGuid);
    if (deviceId !== undefined) {
      seen.add(deviceId);
    }
  }
  return [...seen];
}
