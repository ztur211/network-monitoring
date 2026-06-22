import { IfcAPI } from 'web-ifc';
import type { ElementProperties, PropertySet, PropertyEntry } from './ifc-types';

export function asText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'object' && 'value' in v) return String((v as { value: unknown }).value);
  return String(v);
}

export async function readProperties(
  api: IfcAPI,
  modelID: number,
  expressID: number,
): Promise<ElementProperties> {
  const ifcType = api.GetNameFromTypeCode(api.GetLineType(modelID, expressID));
  const line = api.GetLine(modelID, expressID) as any; // web-ifc line object (dynamic attributes)
  const name = line?.Name ? asText(line.Name) : null;
  const tag = line?.Tag ? asText(line.Tag) : null;

  const sets: PropertySet[] = [];
  // getPropertySets(..., true) inlines the IfcPropertySet handles + their properties.
  const psets: any[] = await (api.properties as any).getPropertySets(modelID, expressID, true);
  for (const ps of psets) {
    const props: PropertyEntry[] = [];
    for (const prop of ps.HasProperties ?? []) {
      const p = typeof prop?.value === 'number' ? (api.GetLine(modelID, prop.value) as any) : prop;
      if (p?.Name) props.push({ name: asText(p.Name), value: asText(p.NominalValue ?? p.Value ?? '') });
    }
    sets.push({ name: ps?.Name ? asText(ps.Name) : 'PropertySet', props });
  }
  return { expressID, ifcType, name, tag, propertySets: sets };
}
