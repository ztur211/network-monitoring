import type { IfcType, ExpressId, VisibilityState } from '../ifc/ifc-types';

/** Element-keyed visibility (merged geometry has no per-element mesh). */
export function isElementVisible(expressID: ExpressId, ifcType: IfcType, s: VisibilityState): boolean {
  if (s.hiddenCategories.has(ifcType)) return false;
  if (s.hiddenElements.has(expressID)) return false;
  if (s.isolated !== null && s.isolated !== expressID) return false;
  return true;
}
