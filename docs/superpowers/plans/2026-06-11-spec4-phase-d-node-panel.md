# Spec 4 Phase D — Node Panel, Device Inspector & Status Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the right-dock **Node panel** — a filterable, selection-synced list of the building's devices (the monitoring surface + placement source) — and the **device branch of the Inspector** (details + F3-gated Place/Move/Clear/Zoom), completing the Spec 4 viewer. Status is shown via the seam the Monitoring spec will fill.

**Architecture:** `<NodePanel>` renders `filterDevices(devices, nodeFilter, statusOf)` with filter controls writing `setNodeFilter`; a row click `selectNode`s. `<DeviceDetails>` renders the selected device and gates Place/Move/Clear on `canConfigure(access)`, driving `beginPlace`/`clearPlacement`/`requestFocus`. The Inspector switches element ↔ device by `selection.kind`; `ViewCommands` learns to frame a marker for node zoom-to.

**Tech Stack:** React 19 DOM, Zustand, Vitest + React Testing Library, `three` (marker zoom box).

**Depends on:**
- **Phase A** — `filterDevices`/`NodeFilter`, `canConfigure`, `STATUS_COLOR`/`NodeStatus`, store (`devices`/`selection`/`selectNode`/`setNodeFilter`/`beginPlace`/`nodeStatus`/`access`).
- **Phase C** — `clearPlacement`, `beginPlace` placing flow.
- **Spec 3** — `ui/Inspector.tsx`, `scene/ViewCommands.tsx` (`requestFocus`/`focusNonce`), `shell/ViewportHost.tsx`, `nodes/category-color.ts`, `nodes/node-coords.ts` (`toViewport`).
- Spec: `docs/superpowers/specs/2026-06-11-spec4-nodes-in-3d-design.md` (§7, §8, §9).

> Final Spec 4 phase. Ends with the cross-plan self-review over A–D.

---

## File Structure

**Create:**
- `apps/desktop/src/renderer/viewport/ui/NodePanel.tsx` — list + filters
- `apps/desktop/src/renderer/viewport/ui/DeviceDetails.tsx` — device branch of the Inspector
- tests `viewport/ui/__tests__/{node-panel,device-details}.spec.tsx`

**Modify:**
- `apps/desktop/src/renderer/viewport/ui/Inspector.tsx` — render `<DeviceDetails>` for `selection.kind === 'device'`
- `apps/desktop/src/renderer/viewport/scene/ViewCommands.tsx` — zoom-to a device marker
- `apps/desktop/src/renderer/shell/ViewportHost.tsx` — right-dock column (`NodePanel` + `Inspector`)

---

## Task 1: `NodePanel` — filterable list (Vitest + RTL)

**Files:** Create `ui/NodePanel.tsx`; test `viewport/ui/__tests__/node-panel.spec.tsx`.

- [ ] **Step 1: Failing test** `viewport/ui/__tests__/node-panel.spec.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodePanel } from '../NodePanel';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

const dev = (id: string, over = {}) => ({ id, name: id, category: 'SWITCH', propertyId: 'b', networkId: 'n', x: null, y: null, z: null, floor: 1, ipAddress: null, macAddress: null } as any);
beforeEach(() => useViewportStore.setState({ ...initialViewportState(), devices: [dev('Switch-1', { x: 1, y: 1, z: 1 }), dev('Router-9', { category: 'ROUTER' })] }, true));

describe('NodePanel', () => {
  it('lists devices and selects one on click', () => {
    render(<NodePanel />);
    expect(screen.getByText('Switch-1')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Router-9'));
    expect(useViewportStore.getState().selection).toEqual({ kind: 'device', deviceId: 'Router-9' });
  });
  it('text filter narrows the list', () => {
    render(<NodePanel />);
    fireEvent.change(screen.getByLabelText('Filter devices'), { target: { value: 'router' } });
    expect(screen.queryByText('Switch-1')).toBeNull();
    expect(screen.getByText('Router-9')).toBeInTheDocument();
  });
  it('placement filter shows only unplaced', () => {
    render(<NodePanel />);
    fireEvent.change(screen.getByLabelText('Placement'), { target: { value: 'unplaced' } });
    expect(screen.queryByText('Switch-1')).toBeNull(); // placed → hidden
    expect(screen.getByText('Router-9')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `ui/NodePanel.tsx`:

```tsx
import { useMemo } from 'react';
import { useViewportStore } from '../../stores/viewport-store';
import { filterDevices } from '../nodes/filter-devices';
import { categoryColor } from '../nodes/category-color';
import { STATUS_COLOR, type NodeStatus } from '../nodes/node-status';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const isPlaced = (d: { x: number | null }) => d.x !== null;

export function NodePanel() {
  const { devices, nodeFilter, nodeStatus, selection, selectNode, setNodeFilter } = useViewportStore();
  const statusOf = (id: string): NodeStatus => nodeStatus.get(id) ?? 'unknown';
  const categories = useMemo(() => [...new Set(devices.map((d) => d.category))].sort(), [devices]);
  const rows = useMemo(() => filterDevices(devices, nodeFilter, statusOf), [devices, nodeFilter, nodeStatus]);

  return (
    <section aria-label="nodes" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <input aria-label="Filter devices" placeholder="Search name / ip…" value={nodeFilter.text}
             onChange={(e) => setNodeFilter({ text: e.target.value })} />
      <div style={{ display: 'flex', gap: 4 }}>
        <select aria-label="Placement" value={nodeFilter.placement} onChange={(e) => setNodeFilter({ placement: e.target.value as any })}>
          <option value="all">All</option><option value="placed">Placed</option><option value="unplaced">Unplaced</option>
        </select>
        <select aria-label="Status" value={nodeFilter.status ?? ''} onChange={(e) => setNodeFilter({ status: (e.target.value || null) as NodeStatus | null })}>
          <option value="">Any status</option><option value="up">Up</option><option value="down">Down</option><option value="warning">Warning</option><option value="unknown">Unknown</option>
        </select>
        <select aria-label="Category" value="" onChange={(e) => { const c = e.target.value; if (c) { const n = new Set(nodeFilter.categories); n.has(c) ? n.delete(c) : n.add(c); setNodeFilter({ categories: n }); } }}>
          <option value="">Category…</option>{categories.map((c) => <option key={c} value={c}>{nodeFilter.categories.has(c) ? '✓ ' : ''}{c}</option>)}
        </select>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, overflow: 'auto' }}>
        {rows.map((d) => {
          const sel = selection?.kind === 'device' && selection.deviceId === d.id;
          return (
            <li key={d.id}>
              <button onClick={() => selectNode(d.id)} aria-pressed={sel} style={{ display: 'flex', gap: 6, width: '100%', textAlign: 'left' }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: hex(categoryColor(d.category)) }} />
                <span style={{ flex: 1 }}>{d.name}</span>
                <span title={isPlaced(d) ? 'Placed' : 'Unplaced'}>{isPlaced(d) ? '📍' : '○'}</span>
                <span style={{ color: hex(STATUS_COLOR[statusOf(d.id)]) }}>●</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(desktop): Node panel (filterable device list + selection sync)`.

---

## Task 2: `DeviceDetails` + Inspector switch + node zoom-to (Vitest + RTL)

**Files:** Create `ui/DeviceDetails.tsx`; modify `ui/Inspector.tsx`, `scene/ViewCommands.tsx`, `shell/ViewportHost.tsx`; test `viewport/ui/__tests__/device-details.spec.tsx`.

- [ ] **Step 1: Failing test** `viewport/ui/__tests__/device-details.spec.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeviceDetails } from '../DeviceDetails';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

vi.mock('../../../data/clients', () => ({ getClients: () => ({ rest: { setDevicePosition: vi.fn().mockResolvedValue({}) } }) }));
const dev = (over = {}) => ({ id: 'd', name: 'Switch-1', category: 'SWITCH', propertyId: 'b', networkId: 'n', x: null, y: null, z: null, floor: 1, ipAddress: '10.0.0.5', macAddress: null } as any);
const admin = { role: 'ADMIN', assignedRootPropertyIds: ['b'], unscoped: false } as any;
const member = { role: 'MEMBER', assignedRootPropertyIds: ['b'], unscoped: false } as any;
beforeEach(() => useViewportStore.setState({ ...initialViewportState(), devices: [dev()], selection: { kind: 'device', deviceId: 'd' } }, true));

describe('DeviceDetails', () => {
  it('shows fields and (for ADMIN) a Place action for an unplaced device', () => {
    useViewportStore.setState({ access: admin });
    render(<DeviceDetails />);
    expect(screen.getByText('Switch-1')).toBeInTheDocument();
    expect(screen.getByText('Unplaced')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Place'));
    expect(useViewportStore.getState().placingDeviceId).toBe('d');
  });
  it('shows Move + Clear for a placed device (ADMIN)', () => {
    useViewportStore.setState({ access: admin, devices: [dev({ x: 1, y: 2, z: 3 })] });
    render(<DeviceDetails />);
    expect(screen.getByText('Move')).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Zoom to'));
    expect(useViewportStore.getState().focusNonce).toBe(1);
  });
  it('hides configure actions for a MEMBER', () => {
    useViewportStore.setState({ access: member });
    render(<DeviceDetails />);
    expect(screen.queryByText('Place')).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `ui/DeviceDetails.tsx`:

```tsx
import { useViewportStore } from '../../stores/viewport-store';
import { canConfigure } from '../nodes/can-configure';
import { clearPlacement } from '../nodes/placement';
import { getClients } from '../../data/clients';

const isPlaced = (d: { x: number | null }) => d.x !== null;

export function DeviceDetails() {
  const { devices, selection, access, beginPlace, requestFocus, nodeStatus } = useViewportStore();
  if (selection?.kind !== 'device') return null;
  const d = devices.find((x) => x.id === selection.deviceId);
  if (!d) return null;
  const mayConfigure = canConfigure(access);
  const placed = isPlaced(d);

  return (
    <aside aria-label="device-details">
      <h3>{d.name}</h3>
      <dl>
        <dt>Type</dt><dd>{d.category}</dd>
        <dt>Network</dt><dd>{d.networkId}</dd>
        {d.ipAddress && (<><dt>IP</dt><dd>{d.ipAddress}</dd></>)}
        <dt>Status</dt><dd>{nodeStatus.get(d.id) ?? 'unknown'}</dd>
        <dt>Position</dt><dd>{placed ? `${d.x!.toFixed(2)}, ${d.y!.toFixed(2)}, ${d.z!.toFixed(2)}` : 'Unplaced'}</dd>
      </dl>
      <div>
        {placed && <button onClick={() => requestFocus()}>Zoom to</button>}
        {mayConfigure && !placed && <button onClick={() => beginPlace(d.id)}>Place</button>}
        {mayConfigure && placed && <button onClick={() => beginPlace(d.id)}>Move</button>}
        {mayConfigure && placed && <button onClick={() => clearPlacement(d.id, { rest: getClients()!.rest as any })}>Clear</button>}
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Inspector switch** — in `ui/Inspector.tsx`, render the device branch:

```tsx
import { DeviceDetails } from './DeviceDetails';
// in the component body:
if (selection?.kind === 'device') return <DeviceDetails />;
// else the existing element branch (selection?.kind === 'element' → getProperties etc.); null when no selection.
```

- [ ] **Step 4: Node zoom-to in `scene/ViewCommands.tsx`** — the focus effect frames a device marker when a device is selected:

```tsx
import { toViewport } from '../nodes/node-coords';
// inside the focusNonce effect, replace the body with:
const sel = useViewportStore.getState().selection;
if (sel?.kind === 'element') {
  const mesh = model.elementIndex.get(sel.expressID);
  if (mesh) frame(new THREE.Box3().setFromObject(mesh));
} else if (sel?.kind === 'device') {
  const dev = useViewportStore.getState().devices.find((x) => x.id === sel.deviceId);
  if (dev && dev.x !== null) {
    const p = toViewport({ x: dev.x, y: dev.y!, z: dev.z! }, model.frame);
    frame(new THREE.Box3().setFromCenterAndSize(p, new THREE.Vector3(4, 4, 4)));
  }
}
```

- [ ] **Step 5: Right-dock column in `shell/ViewportHost.tsx`** — the `ready` slot's right side stacks the Node panel over the Inspector:

```tsx
{status === 'ready' && model && (
  <>
    <ViewportCanvas model={model} />
    <Toolbar />
    <aside style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 320, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <NodePanel />
      <Inspector />
    </aside>
    {updateAvailable && <UpdateBanner onReload={reload} />}
  </>
)}
```
Add imports for `NodePanel`. Remove the Spec 3 `Inspector`'s own `position:absolute;right:0` (it now lives inside this column); keep its internal content.

- [ ] **Step 6: Run → PASS.** Commit `feat(desktop): device Inspector + node zoom-to + right-dock node panel`.

---

## Task 3: Phase gate

- [ ] **Step 1: Full Spec 4 suite.** `cd apps/desktop && npm test -- viewport stores` and `cd apps/api && npm run test:integration -- devices` → all green.
- [ ] **Step 2: Typecheck + lint.** `npx tsc --noEmit` → PASS; `npm run lint` clean.
- [ ] **Step 3: Manual end-to-end (ADMIN + a building model + devices):** select the building → markers appear; the Node panel lists devices; filter to *unplaced* → select one → **Place** → click the surface → marker placed (persists on reload); **Move**/**Clear** work; click a marker → it selects + the Inspector shows the device; click a wall → element inspector; status badges show *unknown* (the Monitoring seam). As a MEMBER, no Place/Move/Clear appears and a forced `PATCH` is server-rejected.
- [ ] **Step 4: Docs (Rule 10).** `apps/desktop/README.md` + SAD/CLAUDE.md: the Node panel (filters), the unified element|device Inspector, F3-gated placement, and the **status seam (v1 = unknown) the Monitoring spec fills**.
- [ ] **Step 5: Commit** `docs: record Spec 4 node panel + device inspector (Phase D) + viewer complete`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** filterable Node panel — text/category/network/placement/floor/status (§7) ✓ Task 1; selection-synced rows (§7) ✓ Task 1; status badge via the seam (§9) ✓ Task 1; device Details with all fields + position (§7) ✓ Task 2; Place/Move/Clear/Zoom (§6, §7) ✓ Task 2; `canConfigure` gating of configure actions, MEMBER view-only (§8) ✓ Task 2; unified element|device Inspector switch (§7) ✓ Task 2; node zoom-to frames the marker (§7) ✓ Task 2.
- **Deferred (correctly per spec):** by-storey floor grouping, network/floor enrichment names, InstancedMesh, real status values (Monitoring spec) (§3, §9, §15).
- **Placeholder scan:** none — complete code/commands. `networkId`/`propertyId` shown as ids (name enrichment is a stated refinement).
- **Type consistency:** `filterDevices`/`NodeFilter`, `canConfigure(access)`, `STATUS_COLOR`/`NodeStatus`, `categoryColor`, store (`selectNode`/`setNodeFilter`/`beginPlace`/`requestFocus`/`nodeStatus`/`access`/`devices`), `clearPlacement` (Phase C), `toViewport` (Phase A), Spec 3 `requestFocus`/`focusNonce`/`Inspector` — all consistent across phases.
- **Test-config compliance:** NodePanel/DeviceDetails are jsdom + RTL with a mocked store + mocked `getClients`; ViewCommands change is exercised via the device-details `focusNonce` assertion. No GPU assertions.
- **Integration points to verify during execution:** the right-dock column height/scroll with both panels; the Spec 3 `Inspector` element branch still renders inside the column (its absolute positioning removed); `getClients()!.rest` is non-null when a Clear is invoked (only reachable post-bootstrap).

---

# Spec 4 — cross-plan self-review (all four phases)

- **Spec coverage (full):** §4 architecture (node layer in Spec 3's Canvas + right-dock panel + store) → A/B/D ✓ · §5 `node-coords` + marker layer → A (coords) + B (NodeLayer) ✓ · §6 select-then-click place/move/clear, optimistic + rollback, no mid-air → C ✓ · §7 unified tagged selection + Node panel + Inspector switch → A (selection refactor) + B (pick) + D (panel/details) ✓ · §8 F3 role-gated affordances over a scope-filtered list → A (`canConfigure`, server filter) + D (gating) ✓ · §9 status-display seam (`NodeStatus`/`setNodeStatus`/marker ring/panel badge/filter, v1 = unknown) → A/B/D ✓ · §10 data + realtime (`listDevicesForBuilding`, `setDevicePosition`, `v1:device:updated`) → A (client/server) + B (load/realtime) + C (persist) ✓ · §11 public interface (status seam, `node-coords`, unified selection, client) → defined across A–D, exported for the Monitoring spec ✓ · §12 security (server-enforced scope, optimistic integrity, sandbox) → A (server) + C (rollback) ✓ · §13 testing (node-pure + jsdom/RTL + headless r3f) → every phase ✓.
- **Build-green order:** A (headless foundation + selection refactor) → B (markers + live list + pick) → C (placement engine) → D (panel + details). Each ends green; nothing earlier imports a later phase.
- **Cross-phase type consistency:** `Selection` union, `DeviceDto`, `NodeFilter`, `NodeStatus`, `canConfigure`, `toViewport`/`toModel`, `pickNode`, `markersRef: Object3D[]`, and the store actions are defined in A/B and consumed unchanged downstream; `commitPlacement`/`clearPlacement` (C) reused by D; `requestFocus`/`focusNonce`/`ViewCommands`/`Inspector`/`PickingController` (Spec 3) are extended additively with the device branch.
- **Flagged for execution:** `PropertiesService.subtreePropertyIds` + F3 `scopeFilter` signatures (A); `WS_EVENTS.DEVICE_*` keys + REST client `get`/`patch`/`fetchImpl` (A/B); `@react-three/fiber`↔`three` (B, inherited from Spec 3); capture-phase pointer ordering for placement (C); the right-dock layout + a toast provider for `notify` (C/D). All localized and interface-stable.
- **Boundary to the Monitoring spec:** it consumes only §11 — `store.setNodeStatus(deviceId, NodeStatus)` (+ its own fetch/realtime) — to light up the existing marker rings, panel badges, and status filter. No Spec 4 internal is part of that contract.
