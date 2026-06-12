# Spec 5 Phase A — IFC GUID + IFC2x3 Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two pure, dependency-free IFC primitives: `toIfcGuid(uuid)` (deterministic 22-char IFC GlobalId) and `buildNetworkIfc(input)` (a valid IFC2x3 STEP string with a spatial tree + one `IfcBuildingElementProxy` per placed device + `Pset_NodeScope`). No DB, no HTTP — fully unit-tested.

**Architecture:** `apps/api/src/export/ifc-guid.ts` encodes a UUID's 128 bits into IFC's base-64 alphabet. `ifc2x3-writer.ts` is a small `StepBuilder` (auto-incrementing `#ids`) + `buildNetworkIfc({ building, storeyName, devices, timestamp })` that assembles the header, units/context, spatial aggregation, a shared box marker, and per-device proxy + property set. STEP strings are escaped.

**Tech Stack:** TypeScript (Node `BigInt`), Jest (unit).

**Depends on:** none (pure). Spec: `docs/superpowers/specs/2026-06-12-spec5-ifc-export-design.md` (§4, §6, §10).

> The service + endpoint that feed this writer real data are Phase B.

---

## File Structure

**Create:**
- `apps/api/src/export/ifc-guid.ts`
- `apps/api/src/export/ifc2x3-writer.ts`
- tests `apps/api/src/export/__tests__/{ifc-guid.spec.ts, ifc2x3-writer.spec.ts}`

---

## Task 1: `toIfcGuid` (Jest unit)

**Files:** Create `export/ifc-guid.ts`; test `export/__tests__/ifc-guid.spec.ts`.

- [ ] **Step 1: Failing test** — 22 chars, valid alphabet, deterministic, round-trips the 128 bits:
```typescript
import { toIfcGuid, IFC_B64 } from '../ifc-guid';

describe('toIfcGuid', () => {
  const uuid = '12345678-1234-5678-1234-567812345678';
  it('produces a deterministic 22-char GUID over the IFC alphabet', () => {
    const g = toIfcGuid(uuid);
    expect(g).toHaveLength(22);
    expect([...g].every((c) => IFC_B64.includes(c))).toBe(true);
    expect(toIfcGuid(uuid)).toBe(g); // deterministic
  });
  it('encodes the full 128 bits (decodes back to the uuid)', () => {
    let n = 0n; for (const c of toIfcGuid(uuid)) n = n * 64n + BigInt(IFC_B64.indexOf(c));
    expect(n.toString(16).padStart(32, '0')).toBe(uuid.replace(/-/g, ''));
  });
  it('different uuids → different guids', () => {
    expect(toIfcGuid(uuid)).not.toBe(toIfcGuid('00000000-0000-0000-0000-000000000001'));
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:unit -- ifc-guid`.

- [ ] **Step 3: Implement `ifc-guid.ts`:**
```typescript
export const IFC_B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** IFC GlobalId: the 128-bit UUID encoded MSB-first into 22 base-64 chars (top char carries 2 bits). */
export function toIfcGuid(uuid: string): string {
  let num = BigInt('0x' + uuid.replace(/-/g, ''));
  const out: string[] = [];
  for (let i = 0; i < 22; i++) { out.push(IFC_B64[Number(num % 64n)]); num /= 64n; }
  return out.reverse().join('');
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): toIfcGuid (deterministic IFC GlobalId)`.

> During implementation, optionally cross-check one value against an IfcOpenShell `compress()` vector; the round-trip test already guarantees a lossless, deterministic encoding.

---

## Task 2: `buildNetworkIfc` (Jest unit)

**Files:** Create `export/ifc2x3-writer.ts`; test `export/__tests__/ifc2x3-writer.spec.ts`.

- [ ] **Step 1: Failing test:**
```typescript
import { buildNetworkIfc, ExportDevice } from '../ifc2x3-writer';

const dev = (over: Partial<ExportDevice>): ExportDevice => ({ id: '11111111-1111-1111-1111-111111111111', name: 'Switch-1', category: 'SWITCH', x: 1.5, y: 2, z: 3, ipAddress: '10.0.0.5', macAddress: null, networkName: 'Core', ...over });

describe('buildNetworkIfc', () => {
  it('emits IFC2x3 with one proxy per device, placements, and Pset_NodeScope', () => {
    const ifc = buildNetworkIfc({ building: { id: '22222222-2222-2222-2222-222222222222', name: 'HQ' }, storeyName: 'Network',
      devices: [dev({ id: '11111111-1111-1111-1111-111111111111', name: "A'B" }), dev({ id: '33333333-3333-3333-3333-333333333333', name: 'Router' })], timestamp: '2026-06-12T00:00:00Z' });
    expect(ifc.startsWith('ISO-10303-21;')).toBe(true);
    expect(ifc).toContain("FILE_SCHEMA(('IFC2X3'))");
    expect((ifc.match(/IFCBUILDINGELEMENTPROXY/g) ?? [])).toHaveLength(2);
    expect(ifc).toContain('IFCCARTESIANPOINT((1.500000,2.000000,3.000000))');
    expect(ifc).toContain("'Pset_NodeScope'");
    expect(ifc).toContain('IFCLABEL(\'SWITCH\')');
    expect((ifc.match(/IFCRELCONTAINEDINSPATIALSTRUCTURE/g) ?? [])).toHaveLength(1); // one containment for all
    expect(ifc).toContain("''B"); // STEP-escaped apostrophe in "A'B" → A''B
    expect(ifc.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  });
  it('zero devices → a valid empty discipline stub', () => {
    const ifc = buildNetworkIfc({ building: { id: '22222222-2222-2222-2222-222222222222', name: 'HQ' }, storeyName: 'Network', devices: [], timestamp: '2026-06-12T00:00:00Z' });
    expect(ifc).toContain('IFCBUILDINGSTOREY');
    expect(ifc).not.toContain('IFCBUILDINGELEMENTPROXY');
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `ifc2x3-writer.ts`:
```typescript
import { toIfcGuid } from './ifc-guid';

export interface ExportDevice { id: string; name: string; category: string; x: number; y: number; z: number; ipAddress: string | null; macAddress: string | null; networkName: string | null; }
export interface BuildNetworkIfcInput { building: { id: string; name: string }; storeyName: string; devices: ExportDevice[]; timestamp: string; }

const step = (s: string | null): string => (s == null ? '$' : `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/[\u0000-\u001f]/g, ' ')}'`);
const label = (s: string | null): string => (s == null ? '$' : `IFCLABEL(${step(s)})`);
const num = (n: number) => n.toFixed(6);

class StepBuilder {
  private id = 0; readonly lines: string[] = [];
  add(body: string): string { const ref = `#${++this.id}`; this.lines.push(`${ref}= ${body};`); return ref; }
}

export function buildNetworkIfc(input: BuildNetworkIfcInput): string {
  const b = new StepBuilder();
  const g = (suffix = '') => `'${toIfcGuid(suffix ? `${input.building.id}:${suffix}` : input.building.id)}'`;

  // owner history
  const person = b.add(`IFCPERSON($,$,'NodeScope',$,$,$,$,$)`);
  const org = b.add(`IFCORGANIZATION($,'NodeScope',$,$,$)`);
  const po = b.add(`IFCPERSONANDORGANIZATION(${person},${org},$)`);
  const app = b.add(`IFCAPPLICATION(${org},'1.0','NodeScope','NodeScope')`);
  const ts = Math.floor(Date.parse(input.timestamp) / 1000) || 0;
  const owner = b.add(`IFCOWNERHISTORY(${po},${app},$,.ADDED.,$,${po},${app},${ts})`);

  // units + 3D context + project
  const metre = b.add(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`);
  const units = b.add(`IFCUNITASSIGNMENT((${metre}))`);
  const origin = b.add(`IFCCARTESIANPOINT((0.,0.,0.))`);
  const worldAxis = b.add(`IFCAXIS2PLACEMENT3D(${origin},$,$)`);
  const ctx = b.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,${worldAxis},$)`);
  b.add(`IFCPROJECT(${g()},${owner},${step('NodeScope Network — ' + input.building.name)},$,$,$,$,(${ctx}),${units})`);
  const project = `#${b.lines.length}`;

  const place = (relTo: string | null, x = 0, y = 0, z = 0) => {
    const p = b.add(`IFCCARTESIANPOINT((${num(x)},${num(y)},${num(z)}))`);
    const a = b.add(`IFCAXIS2PLACEMENT3D(${p},$,$)`);
    return b.add(`IFCLOCALPLACEMENT(${relTo ?? '$'},${a})`);
  };
  const sitePl = place(null);
  const site = b.add(`IFCSITE(${g('site')},${owner},'Site',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldPl = place(sitePl);
  const building = b.add(`IFCBUILDING(${g('bldg')},${owner},${step(input.building.name)},$,$,${bldPl},$,$,.ELEMENT.,$,$,$)`);
  const storeyPl = place(bldPl);
  const storey = b.add(`IFCBUILDINGSTOREY(${g('storey')},${owner},${step(input.storeyName)},$,$,${storeyPl},$,$,.ELEMENT.,0.)`);
  b.add(`IFCRELAGGREGATES(${g('a0')},${owner},$,$,${project},(${site}))`);
  b.add(`IFCRELAGGREGATES(${g('a1')},${owner},$,$,${site},(${building}))`);
  b.add(`IFCRELAGGREGATES(${g('a2')},${owner},$,$,${building},(${storey}))`);

  // shared 0.2m box marker (each proxy's local placement positions it)
  const o2d = b.add(`IFCCARTESIANPOINT((0.,0.))`);
  const pos2d = b.add(`IFCAXIS2PLACEMENT2D(${o2d},$)`);
  const profile = b.add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${pos2d},0.2,0.2)`);
  const up = b.add(`IFCDIRECTION((0.,0.,1.))`);
  const solid = b.add(`IFCEXTRUDEDAREASOLID(${profile},${worldAxis},${up},0.2)`);
  const shapeRep = b.add(`IFCSHAPEREPRESENTATION(${ctx},'Body','SweptSolid',(${solid}))`);
  const prodDef = b.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${shapeRep}))`);

  const proxies: string[] = [];
  for (const d of input.devices) {
    const pl = place(storeyPl, d.x, d.y, d.z);
    const proxy = b.add(`IFCBUILDINGELEMENTPROXY('${toIfcGuid(d.id)}',${owner},${step(d.name)},$,${step(d.category)},${pl},${prodDef},$,$)`);
    proxies.push(proxy);
    const props = [
      b.add(`IFCPROPERTYSINGLEVALUE('Category',$,${label(d.category)},$)`),
      b.add(`IFCPROPERTYSINGLEVALUE('IPAddress',$,${label(d.ipAddress)},$)`),
      b.add(`IFCPROPERTYSINGLEVALUE('MACAddress',$,${label(d.macAddress)},$)`),
      b.add(`IFCPROPERTYSINGLEVALUE('Network',$,${label(d.networkName)},$)`),
      b.add(`IFCPROPERTYSINGLEVALUE('NodeScopeId',$,${label(d.id)},$)`),
    ];
    const pset = b.add(`IFCPROPERTYSET('${toIfcGuid(`${d.id}:pset`)}',${owner},'Pset_NodeScope',$,(${props.join(',')}))`);
    b.add(`IFCRELDEFINESBYPROPERTIES('${toIfcGuid(`${d.id}:rel`)}',${owner},$,$,(${proxy}),${pset})`);
  }
  if (proxies.length) b.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${g('contain')},${owner},$,$,(${proxies.join(',')}),${storey})`);

  const header = [
    'ISO-10303-21;', 'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    `FILE_NAME('${input.building.name.replace(/'/g, "''")}-network.ifc','${input.timestamp}',('NodeScope'),('NodeScope'),'NodeScope','NodeScope','');`,
    "FILE_SCHEMA(('IFC2X3'));", 'ENDSEC;', 'DATA;',
  ].join('\n');
  return `${header}\n${b.lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}
```
*(The structure follows IFC2x3; deep tool-import validity is confirmed manually with a sample, per spec §10. The `project` reference is captured immediately after its `add`.)*

- [ ] **Step 3: Run → PASS.** Commit `feat(api): IFC2x3 network-discipline writer (buildNetworkIfc)`.

---

## Task 3: Phase gate

- [ ] **Step 1: Suite.** `cd apps/api && npm run test:unit -- export` → green.
- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` → PASS.
- [ ] **Step 3: Manual validity (recommended):** write a sample export to a file and open it in a free IFC viewer (e.g. the IfcOpenShell viewer / online IFC.js viewer) — confirm the proxies appear at their coordinates with `Pset_NodeScope`. Adjust attribute order only if a tool rejects it.
- [ ] **Step 4: Commit** `docs: record Spec 5 IFC writer (Phase A)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** deterministic `toIfcGuid` (§4, §6) ✓ Task 1; IFC2x3 header/units/context/spatial-tree (§4) ✓ Task 2; proxy per device + placement + box marker + `Pset_NodeScope` (§4) ✓ Task 2; STEP-escaping (§9) ✓ Task 2 (`step`/`label`); empty-export stub (§4) ✓ Task 2.
- **Deferred (correctly NOT here):** the device query + F3 scope + the streaming endpoint (Phase B); per-floor storeys / IFC4 / stored history (spec §12).
- **Placeholder scan:** none — complete code. Tool-import validity is a stated manual check (the unit tests assert the structural contract: schema, proxy count, coords, pset, containment, escaping).
- **Type consistency:** `ExportDevice`/`BuildNetworkIfcInput` are Phase B's exact input; `toIfcGuid`/`IFC_B64` shared; `buildNetworkIfc` returns the streamed string.
- **Test-config compliance:** pure unit tests (no DB/HTTP). The writer is deterministic given a fixed `timestamp`.
- **Integration points to verify during execution:** an IfcOpenShell GUID vector (optional); a real IFC viewer for import validity; whether any consumer tool needs `IFC4` (then add the §12 variant).
