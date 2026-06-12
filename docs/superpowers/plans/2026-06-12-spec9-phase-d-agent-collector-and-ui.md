# Spec 9 Phase D — Agent SNMP Collector & Config UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the agent `snmpCollector` (net-snmp scalar GET + ifXTable walk) on Spec 8's collector seam, register it in the poll cycle, and build the web config UI (credentials / OID profiles / assignment) — completing Spec 9 and the monitoring/agent track.

**Architecture:** `snmpCollector(sessionFactory)` is a Spec 8 `Collector`; it reads `device.snmp` and emits generic metrics, with the net-snmp specifics behind an injectable `SnmpSession` so the collector logic is unit-tested with a fake. The real `netSnmpSessionFactory` wraps `net-snmp`. The web settings gain an SNMP screen over the Phase B endpoints.

**Tech Stack:** TypeScript, `net-snmp` (pure-JS), Vitest (agent); React-Native-Web + RTL (web).

**Depends on:**
- **Phase A–C** — `AgentDeviceDto.snmp`/`SnmpTargetDto`; the `/v1/snmp/*` endpoints.
- **Spec 8** — the `Collector`/`CollectResult` seam, `runCycle` (to register the collector), `MetricSampleDto`.
- Spec: `2026-06-12-spec9-agent-snmp-design.md` (§8, §9).

> Final Spec 9 phase. Ends with the cross-plan review over A–D.

---

## File Structure

**Create:**
- `apps/agent/src/snmp-collector.ts` — `snmpCollector`, `SnmpSession`, OID constants
- `apps/agent/src/net-snmp-session.ts` — the real `net-snmp` adapter
- `apps/web/.../screens/SnmpSettings.tsx` (+ client calls)
- tests `apps/agent/src/__tests__/snmp-collector.spec.ts`, `apps/web/.../__tests__/SnmpSettings.spec.tsx`

**Modify:**
- `apps/agent/package.json` — add `net-snmp`
- `apps/agent/src/runtime.ts` + `index.ts` — register `snmpCollector` in the cycle

---

## Task 1: `snmpCollector` (Vitest, fake session)

**Files:** Create `snmp-collector.ts`; test `__tests__/snmp-collector.spec.ts`.

- [ ] **Step 1: Failing test:**
```typescript
import { describe, it, expect } from 'vitest';
import { snmpCollector } from '../snmp-collector';

const device = (snmp?: any) => ({ id: 'd', name: 'D', ipAddress: '10.0.0.1', snmp });

const fakeFactory = () => ({
  get: async (oid: string) => (oid === '1.3.6.1.2.1.1.3.0' ? 123 : 7),
  walkColumn: async (base: string) => [{ index: '1', value: base.endsWith('.6') ? 1000 : 2000 }],
  close: () => {},
});

describe('snmpCollector', () => {
  it('no snmp config → empty', async () => {
    expect(await snmpCollector(fakeFactory as any).collect(device())).toEqual({ checks: [], metrics: [] });
  });
  it('scalar + interface metrics', async () => {
    const out = await snmpCollector(fakeFactory as any).collect(device({ version: 'V2C', community: 'public', oids: [{ oid: '1.3.6.1.2.1.1.5.0', metric: 'sysname' }], interfaceMetrics: true }));
    const names = out.metrics.map((m) => m.metric);
    expect(names).toContain('sys_uptime'); expect(names).toContain('sysname');
    expect(names).toContain('if_hc_in_octets.1'); expect(names).toContain('if_oper_status.1');
    expect(out.checks).toEqual([]);
  });
  it('a session error yields no metrics (no throw)', async () => {
    const boom = () => ({ get: async () => { throw new Error('timeout'); }, walkColumn: async () => [], close: () => {} });
    await expect(snmpCollector(boom as any).collect(device({ version: 'V2C', community: 'x', oids: [{ oid: '1', metric: 'm' }], interfaceMetrics: false }))).resolves.toEqual({ checks: [], metrics: [] });
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `snmp-collector.ts`:
```typescript
import type { AgentDeviceDto, MetricSampleDto, SnmpTargetDto } from '@nodescope/shared';
import type { Collector, CollectResult } from './poller';

const SYS_UPTIME = '1.3.6.1.2.1.1.3.0';
const IF_HC_IN = '1.3.6.1.2.1.31.1.1.1.6';
const IF_HC_OUT = '1.3.6.1.2.1.31.1.1.1.10';
const IF_OPER = '1.3.6.1.2.1.2.2.1.8';

export interface SnmpSession {
  get(oid: string): Promise<number | null>;
  walkColumn(baseOid: string): Promise<{ index: string; value: number }[]>;
  close(): void;
}
export type SnmpSessionFactory = (host: string, target: SnmpTargetDto) => SnmpSession;

export function snmpCollector(factory: SnmpSessionFactory): Collector {
  return {
    async collect(device: AgentDeviceDto): Promise<CollectResult> {
      if (!device.snmp) return { checks: [], metrics: [] };
      const metrics: MetricSampleDto[] = [];
      let session: SnmpSession | undefined;
      try {
        session = factory(device.ipAddress, device.snmp);
        const up = await session.get(SYS_UPTIME);
        if (up != null) metrics.push({ deviceId: device.id, metric: 'sys_uptime', value: up });
        for (const { oid, metric } of device.snmp.oids) {
          const v = await session.get(oid);
          if (v != null) metrics.push({ deviceId: device.id, metric, value: v });
        }
        if (device.snmp.interfaceMetrics) {
          for (const [base, name] of [[IF_HC_IN, 'if_hc_in_octets'], [IF_HC_OUT, 'if_hc_out_octets'], [IF_OPER, 'if_oper_status']] as const) {
            for (const r of await session.walkColumn(base)) metrics.push({ deviceId: device.id, metric: `${name}.${r.index}`, value: r.value });
          }
        }
      } catch { return { checks: [], metrics: [] }; }   // per-device SNMP error → skip this cycle
      finally { session?.close(); }
      return { checks: [], metrics };
    },
  };
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(agent): SNMP collector (scalar + ifXTable, session-abstracted)`.

---

## Task 2: Real `net-snmp` session + register in the cycle

**Files:** Create `net-snmp-session.ts`; modify `runtime.ts`, `index.ts`; `package.json`.

- [ ] **Step 1: Add the dep.** `cd apps/agent && npm i net-snmp`.

- [ ] **Step 2: Implement `net-snmp-session.ts`** (the real adapter; verified against gear, not unit-tested):
```typescript
import * as snmp from 'net-snmp';
import type { SnmpTargetDto } from '@nodescope/shared';
import type { SnmpSession, SnmpSessionFactory } from './snmp-collector';

const toNumber = (v: unknown): number | null => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : null);

export const netSnmpSessionFactory: SnmpSessionFactory = (host, t): SnmpSession => {
  const session = t.version === 'V3'
    ? snmp.createV3Session(host, { name: t.securityName!, level: snmp.SecurityLevel[t.securityLevel as keyof typeof snmp.SecurityLevel],
        authProtocol: snmp.AuthProtocols[(t.authProtocol ?? 'sha') as keyof typeof snmp.AuthProtocols], authKey: t.authKey,
        privProtocol: snmp.PrivProtocols[(t.privProtocol ?? 'aes') as keyof typeof snmp.PrivProtocols], privKey: t.privKey })
    : snmp.createSession(host, t.community ?? 'public', { version: snmp.Version2c });
  return {
    get: (oid) => new Promise((res) => session.get([oid], (err: unknown, vbs: any[]) => res(err || !vbs?.[0] || snmp.isVarbindError(vbs[0]) ? null : toNumber(vbs[0].value)))),
    walkColumn: (base) => new Promise((res) => {
      const rows: { index: string; value: number }[] = [];
      session.subtree(base, (vbs: any[]) => { for (const vb of vbs) { const v = toNumber(vb.value); if (v != null) rows.push({ index: vb.oid.slice(base.length + 1), value: v }); } },
        (err: unknown) => res(err ? [] : rows));
    }),
    close: () => session.close(),
  };
};
```
*(The exact `net-snmp` call shapes — `createV3Session`, `subtree`, varbind types — are confirmed against the pinned version during this step; the collector logic is already green via the fake.)*

- [ ] **Step 3: Register in `runtime.ts`** — `runCycle` builds both collectors:
```typescript
import { snmpCollector, type SnmpSessionFactory } from './snmp-collector';
// runCycle deps gains `snmpFactory: SnmpSessionFactory`; the collector list becomes:
const collectors = [reachabilityCollector(deps.probe), snmpCollector(deps.snmpFactory)];
const batch = await pollDevices(devices, collectors, deps.concurrency);
```
In `index.ts`, pass `snmpFactory: netSnmpSessionFactory` into `runCycle`.

- [ ] **Step 4: Run → PASS.** `cd apps/agent && npm test` (collector + existing) green. Commit `feat(agent): wire net-snmp session + register snmpCollector in the cycle`.

---

## Task 3: SNMP config UI (Vitest + RTL)

**Files:** Create `apps/web/.../screens/SnmpSettings.tsx` (+ client calls); test `__tests__/SnmpSettings.spec.tsx`.

- [ ] **Step 1: Failing test:**
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SnmpSettings } from '../screens/SnmpSettings';

const client = {
  listSnmpCredentials: vi.fn().mockResolvedValue([{ id: 'c', name: 'core', snmpVersion: 'V2C', hasCommunity: true }]),
  createSnmpCredential: vi.fn().mockResolvedValue({ id: 'c2', name: 'new' }),
  listOidProfiles: vi.fn().mockResolvedValue([]),
};
it('lists credentials and creates one (write-only secret)', async () => {
  render(<SnmpSettings client={client as any} />);
  await waitFor(() => expect(screen.getByText('core')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('Credential name'), { target: { value: 'edge' } });
  fireEvent.change(screen.getByLabelText('Community'), { target: { value: 'public' } });
  fireEvent.click(screen.getByText('Add credential'));
  await waitFor(() => expect(client.createSnmpCredential).toHaveBeenCalledWith(expect.objectContaining({ name: 'edge', snmpVersion: 'V2C', community: 'public' })));
});
```

- [ ] **Step 2: Run → FAIL**, then implement `SnmpSettings.tsx` (RN-Web; client-injected; secrets are write-only inputs):
```tsx
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, FlatList } from 'react-native';

export function SnmpSettings({ client }: { client: { listSnmpCredentials(): Promise<any[]>; createSnmpCredential(d: any): Promise<any>; listOidProfiles(): Promise<any[]> } }) {
  const [creds, setCreds] = useState<any[]>([]);
  const [name, setName] = useState(''); const [community, setCommunity] = useState('');
  const reload = () => client.listSnmpCredentials().then(setCreds);
  useEffect(() => { reload(); }, []);
  return (
    <View>
      <Text>SNMP credentials</Text>
      <FlatList data={creds} keyExtractor={(c) => c.id} renderItem={({ item }) => <Text>{item.name} · {item.snmpVersion}</Text>} />
      <TextInput accessibilityLabel="Credential name" value={name} onChangeText={setName} placeholder="name" />
      <TextInput accessibilityLabel="Community" value={community} onChangeText={setCommunity} placeholder="community (write-only)" secureTextEntry />
      <Button title="Add credential" onPress={async () => { await client.createSnmpCredential({ name, snmpVersion: 'V2C', community }); setName(''); setCommunity(''); reload(); }} />
    </View>
  );
}
```
Add `listSnmpCredentials`/`createSnmpCredential`/`listOidProfiles`/`createOidProfile`/`assignSnmp` to the web API client; mount `SnmpSettings` (+ an OID-profile section and a per-network assignment picker) in org settings, following existing patterns.

- [ ] **Step 3: Run → PASS.** Commit `feat(web): SNMP settings (credentials/profiles/assignment)`.

---

## Task 4: Phase gate + cross-plan review

- [ ] **Step 1: Suites.** `cd apps/agent && npm test`; `cd apps/web && npm test -- SnmpSettings`; `cd apps/api && npm run test:e2e -- snmp` → green.
- [ ] **Step 2: Typecheck** across `apps/agent`/`apps/web`/`apps/api` → PASS.
- [ ] **Step 3: Manual end-to-end:** create a v2c credential + an OID profile (interface metrics on) in the UI → assign to a network → an enrolled agent polls those devices via SNMP → `if_hc_in_octets.*` + custom metrics appear in Spec 7's `/metrics` and chart in Spec 4 later. A bad credential → no SNMP metrics, no crash (reachability unaffected).
- [ ] **Step 4: Docs (Rule 10).** `apps/agent/README.md` (SNMP collection, `net-snmp`); SAD/CLAUDE.md (CryptoService vault, SNMP model, agent collector); roadmap doc (Desktop Agent: SNMP shipped → monitoring track complete).
- [ ] **Step 5: Commit** `docs: record Spec 9 agent SNMP collector + UI (Phase D) + track complete`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** scalar GET + sysUpTime (§8) ✓ Task 1; ifXTable walk → `if_hc_*.<ifIndex>` (§8) ✓ Task 1; v2c + v3 session (§8) ✓ Task 2; per-device error → no metrics, no crash (§8) ✓ Task 1; registered beside reachability, no-op without `snmp` (§8) ✓ Tasks 1–2; config UI write-only secret + assignment (§9) ✓ Task 3.
- **Deferred (correctly per spec):** arbitrary table mapping, traps/SET, key-rotation automation, a metrics labels column, a separate SNMP cadence, session pooling (§3, §14).
- **Placeholder scan:** none — concrete code/commands. `net-snmp-session.ts` is the real adapter (manually/gear-verified), with collector logic green via the fake `SnmpSession`.
- **Type consistency:** `SnmpSession`/`SnmpSessionFactory` ↔ `snmpCollector` ↔ `netSnmpSessionFactory` ↔ `runCycle`; `Collector`/`CollectResult`/`MetricSampleDto` (Spec 8); `AgentDeviceDto.snmp`/`SnmpTargetDto` (Phase C); metric naming `if_hc_in_octets.<ifIndex>` (spec §8/§11).
- **Test-config compliance:** collector unit (fake session, no net-snmp); web RTL (mocked client); the real net-snmp adapter is exercised by the manual smoke. No GPU/network in unit tests.
- **Integration points to verify during execution:** the pinned `net-snmp` API (`createV3Session`/`subtree`/varbind value types — BigInt for 64-bit counters → `Number`); the web settings nav + client patterns; `runCycle`'s deps signature gains `snmpFactory` (Spec 8 callers updated).

---

# Spec 9 — cross-plan self-review (all four phases)

- **Spec coverage (full):** §4 architecture (snmp module + agent collector + crypto) → A/B/C/D ✓ · §5 `CryptoService` → A ✓ · §6 models + assignment + resolution → A (models) + B (delete-block) + C (resolution) ✓ · §7 device-sync `SnmpTargetDto` (decrypted) → C ✓ · §8 agent collector (scalar + ifXTable, v2c/v3, error-safe) → D ✓ · §9 CRUD + assignment + UI → B + D ✓ · §10 security (encrypted-at-rest, write-only reads, decrypt-only-into-sync, OWNER/ADMIN, F3) → A/B/C ✓ · §11 public interface (CryptoService, metric shapes, SnmpTargetDto) → A/C/D ✓ · §12 testing → every phase ✓.
- **Build-green order:** A (crypto + models + repo) → B (service/CRUD/assignment, encrypt + `SNMP_003`) → C (resolution + decrypt into Spec 8 device-sync) → D (agent collector consumes `snmp`; UI). Each ends green; nothing earlier imports a later phase.
- **Cross-phase type consistency:** `CryptoService` (A) → B encrypt / C decrypt; `SnmpRepository` (A) → B/C; `SnmpService` grows A→B(CRUD)→C(resolve); `SnmpCredentialDto`/`OidProfileDto`/`AssignSnmpDto` (B) ↔ controller ↔ UI; `SnmpTargetDto`/`AgentDeviceDto.snmp` (C) ↔ Spec 8 device-sync ↔ D collector; `Collector`/`MetricSampleDto` (Spec 8) ↔ `snmpCollector`; `snmpVersion` (model) → `version` (target DTO).
- **Flagged for execution:** the `ChangeLog` CHECK + `SECRET_ENCRYPTION_KEY` (A); F3 `assertCanConfigure` + `@CurrentMember` (B); `AgentModule`↔`SnmpModule` import / the Spec 8 controller gaining `SnmpService` (C); the pinned `net-snmp` API + the web settings nav + `runCycle` deps (D). All localized.
- **Track complete:** Spec 4 (display seam) → Spec 7 (server pipeline + embedded prober) → Spec 8 (Agent Core) → Spec 9 (Agent SNMP) close the monitoring/agent track end-to-end: SNMP metrics flow agent → `POST /ingest` (per-agent token, `source=agent:<id>`) → Spec 7 `DeviceMetric` (Timescale) → Spec 7 `/metrics` → Spec 4 panel. No further monitoring spec.
