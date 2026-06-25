import type { DeviceDto } from '@nodescope/shared';
import type { ParsedModel, ExpressId } from '../ifc/ifc-types';

/**
 * guid → device, for every device that points at a BIM element. The IFC GlobalId (GUID) is the only
 * join between the model and network data, so this index is how a clicked BIM object resolves to its
 * live network device. Last-writer-wins if two devices somehow claim the same element.
 */
export function buildIfcLinkIndex(devices: DeviceDto[]): Map<string, DeviceDto> {
  const index = new Map<string, DeviceDto>();
  for (const d of devices) {
    if (d.ifcGlobalId) index.set(d.ifcGlobalId, d);
  }
  return index;
}

/**
 * Reverse of ParsedModel.guidIndex (guid → expressID): expressID → guid, so a picked element can be
 * resolved to the GlobalId we persist on the device. Build once per model (memoize on the caller).
 */
export function buildGuidByExpressId(model: ParsedModel): Map<ExpressId, string> {
  const out = new Map<ExpressId, string>();
  for (const [guid, expressID] of model.guidIndex) out.set(expressID, guid);
  return out;
}

/** The device linked to a clicked element, or undefined. Returns undefined for an element with no guid. */
export function deviceForElement(
  linkIndex: Map<string, DeviceDto>,
  guidByExpressId: Map<ExpressId, string>,
  expressID: ExpressId,
): DeviceDto | undefined {
  const guid = guidByExpressId.get(expressID);
  return guid ? linkIndex.get(guid) : undefined;
}
