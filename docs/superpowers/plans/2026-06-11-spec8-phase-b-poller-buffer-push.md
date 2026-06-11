# Spec 8 Phase B — API Client, Poller, Offline Buffer & Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent collect and ship: a token-authed API client (`syncDevices`/`ingest`/`heartbeat`), a poller with a **collector seam** + a reachability collector (`@nodescope/probe`), a file-backed **offline buffer** with backoff, and an orchestrator cycle wiring sync → poll → buffer → flush.

**Architecture:** `api-client.ts` sends the per-agent token (`x-agent-token`) to Spec 7/8 endpoints. `poller.ts` runs registered `Collector`s per synced device and merges their `{ checks, metrics }`; `reachabilityCollector` wraps `probeDevice`. `buffer.ts` persists pending batches (drop-oldest cap) and `drain`s them through a flush fn, keeping them on failure. `runCycle` composes one sync+poll+flush; `index.ts` schedules it.

**Tech Stack:** TypeScript, Node, Vitest; `@nodescope/probe`, `@nodescope/shared`.

**Depends on:**
- **Phase A** — `loadConfig`/`AgentConfig`, `loadCredentials`/`Credentials`, `enroll`, `@nodescope/probe` (`probeDevice`), `AgentDeviceDto`.
- **Spec 7** — `StatusCheckDto`/`MetricSampleDto`/`IngestBatchDto`, `POST /v1/monitoring/ingest`.
- Spec: `docs/superpowers/specs/2026-06-11-spec8-agent-core-design.md` (§7, §8).

> The agent talks to **mocked HTTP** here; the real server endpoints are Phase C/D (e2e in D).

---

## File Structure

**Create:**
- `apps/agent/src/api-client.ts` — `createAgentClient`
- `apps/agent/src/poller.ts` — `Collector`, `reachabilityCollector`, `pollDevices`, `mapLimit`
- `apps/agent/src/buffer.ts` — `createBuffer`
- `apps/agent/src/runtime.ts` — `runCycle`; `index.ts` — service entrypoint
- tests `apps/agent/src/__tests__/*.spec.ts`

---

## Task 1: `api-client` (Vitest)

**Files:** Create `api-client.ts`; test `__tests__/api-client.spec.ts`.

- [ ] **Step 1: Failing test:**
```typescript
import { describe, it, expect, vi } from 'vitest';
import { createAgentClient } from '../api-client';

const ok = (data: unknown) => ({ ok: true, json: async () => ({ success: true, data, timestamp: '' }) });

describe('agent api-client', () => {
  it('syncDevices GETs with the agent token', async () => {
    const f = vi.fn().mockResolvedValue(ok([{ id: 'd', name: 'D', ipAddress: '10.0.0.1' }]));
    const c = createAgentClient({ apiUrl: 'http://h/api', token: 'tok', fetchImpl: f });
    expect(await c.syncDevices()).toHaveLength(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://h/api/v1/monitoring/agent/devices');
    expect(init.headers['x-agent-token']).toBe('tok');
  });
  it('ingest POSTs the batch', async () => {
    const f = vi.fn().mockResolvedValue(ok({ accepted: 1 }));
    const c = createAgentClient({ apiUrl: 'http://h/api', token: 'tok', fetchImpl: f });
    await c.ingest({ checks: [{ deviceId: 'd', ok: true, latencyMs: 5 }], metrics: [] });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://h/api/v1/monitoring/ingest'); expect(init.method).toBe('POST');
  });
  it('throws on a 401 (revoked)', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const c = createAgentClient({ apiUrl: 'http://h/api', token: 'x', fetchImpl: f });
    await expect(c.heartbeat()).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `api-client.ts`:
```typescript
import type { AgentDeviceDto, IngestBatchDto } from '@nodescope/shared';

export interface AgentClient {
  syncDevices(): Promise<AgentDeviceDto[]>;
  ingest(batch: IngestBatchDto): Promise<void>;
  heartbeat(): Promise<void>;
}

export function createAgentClient(o: { apiUrl: string; token: string; fetchImpl?: typeof fetch }): AgentClient {
  const f = o.fetchImpl ?? fetch;
  const headers = { 'content-type': 'application/json', 'x-agent-token': o.token };
  const call = async (path: string, init?: RequestInit) => {
    const res = await f(`${o.apiUrl}${path}`, { ...init, headers });
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}`);
    return (await res.json()) as { data: unknown };
  };
  return {
    async syncDevices() { return (await call('/v1/monitoring/agent/devices')).data as AgentDeviceDto[]; },
    async ingest(batch) { await call('/v1/monitoring/ingest', { method: 'POST', body: JSON.stringify(batch) }); },
    async heartbeat() { await call('/v1/monitoring/agent/heartbeat', { method: 'POST', body: '{}' }); },
  };
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(agent): token-authed api client`.

---

## Task 2: Poller + reachability collector (Vitest)

**Files:** Create `poller.ts`; test `__tests__/poller.spec.ts`.

- [ ] **Step 1: Failing test:**
```typescript
import { describe, it, expect } from 'vitest';
import { reachabilityCollector, pollDevices, mapLimit } from '../poller';

const devices = [{ id: 'a', name: 'A', ipAddress: '10.0.0.1' }, { id: 'b', name: 'B', ipAddress: '10.0.0.2' }];

describe('poller', () => {
  it('reachabilityCollector emits a check + latency metric', async () => {
    const probe = async (ip: string) => ({ ok: ip === '10.0.0.1', latencyMs: 7 });
    const out = await reachabilityCollector(probe).collect(devices[0]);
    expect(out.checks[0]).toMatchObject({ deviceId: 'a', ok: true, latencyMs: 7 });
    expect(out.metrics[0]).toMatchObject({ deviceId: 'a', metric: 'latency_ms', value: 7 });
  });
  it('pollDevices merges all collectors over all devices', async () => {
    const probe = async (ip: string) => ({ ok: ip === '10.0.0.1', latencyMs: 7 });
    const batch = await pollDevices(devices, [reachabilityCollector(probe)], 2);
    expect(batch.checks.map((c) => c.deviceId).sort()).toEqual(['a', 'b']);
    expect(batch.checks.find((c) => c.deviceId === 'b')!.ok).toBe(false);
  });
  it('mapLimit runs all under a cap', async () => {
    const seen: number[] = []; await mapLimit([1, 2, 3], 2, async (n) => { seen.push(n); });
    expect(seen.sort()).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `poller.ts`:
```typescript
import type { AgentDeviceDto, StatusCheckDto, MetricSampleDto, IngestBatchDto } from '@nodescope/shared';
import { probeDevice, type ProbeResult } from '@nodescope/probe';
import type { AgentConfig } from './config';

export interface CollectResult { checks: StatusCheckDto[]; metrics: MetricSampleDto[] }
export interface Collector { collect(device: AgentDeviceDto): Promise<CollectResult> }

export function reachabilityCollector(probe: (ip: string) => Promise<ProbeResult>): Collector {
  return {
    async collect(d) {
      const r = await probe(d.ipAddress);
      const checks: StatusCheckDto[] = [{ deviceId: d.id, ok: r.ok, latencyMs: r.latencyMs }];
      const metrics: MetricSampleDto[] = r.latencyMs != null ? [{ deviceId: d.id, metric: 'latency_ms', value: r.latencyMs }] : [];
      return { checks, metrics };
    },
  };
}

export function probeFromConfig(cfg: AgentConfig): (ip: string) => Promise<ProbeResult> {
  return (ip) => probeDevice(ip, { icmpEnabled: cfg.icmpEnabled, ports: cfg.ports, timeoutMs: cfg.timeoutMs });
}

export async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const n = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: n }, async () => { while (queue.length) await fn(queue.shift()!); }));
}

export async function pollDevices(devices: AgentDeviceDto[], collectors: Collector[], concurrency: number): Promise<IngestBatchDto> {
  const checks: StatusCheckDto[] = []; const metrics: MetricSampleDto[] = [];
  await mapLimit(devices, concurrency, async (d) => {
    for (const c of collectors) { const r = await c.collect(d); checks.push(...r.checks); metrics.push(...r.metrics); }
  });
  return { checks, metrics };
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(agent): poller with collector seam + reachability`.

---

## Task 3: Offline buffer (Vitest)

**Files:** Create `buffer.ts`; test `__tests__/buffer.spec.ts`.

- [ ] **Step 1: Failing test:**
```typescript
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBuffer } from '../buffer';

const path = () => join(mkdtempSync(join(tmpdir(), 'buf-')), 'queue.jsonl');

describe('buffer', () => {
  it('persists, drains on success, keeps on failure', async () => {
    const p = path();
    const buf = createBuffer({ path: p, maxItems: 10 });
    buf.enqueue({ checks: [{ deviceId: 'a', ok: true }], metrics: [] });
    expect(buf.size()).toBe(1);
    await buf.drain(async () => { throw new Error('offline'); }).catch(() => {});
    expect(buf.size()).toBe(1);                              // kept
    expect(createBuffer({ path: p, maxItems: 10 }).size()).toBe(1); // persisted across restart
    const flush = vi.fn().mockResolvedValue(undefined);
    await buf.drain(flush);
    expect(flush).toHaveBeenCalledTimes(1); expect(buf.size()).toBe(0);
  });
  it('drops oldest beyond the cap', () => {
    const buf = createBuffer({ path: path(), maxItems: 2 });
    buf.enqueue({ checks: [{ deviceId: '1', ok: true }], metrics: [] });
    buf.enqueue({ checks: [{ deviceId: '2', ok: true }], metrics: [] });
    buf.enqueue({ checks: [{ deviceId: '3', ok: true }], metrics: [] });
    expect(buf.size()).toBe(2);
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `buffer.ts`:
```typescript
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IngestBatchDto } from '@nodescope/shared';

export interface Buffer { enqueue(b: IngestBatchDto): void; drain(flush: (b: IngestBatchDto) => Promise<void>): Promise<void>; size(): number; }

export function createBuffer(o: { path: string; maxItems: number }): Buffer {
  let pending: IngestBatchDto[] = [];
  try { pending = readFileSync(o.path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { /* empty */ }
  const persist = () => { mkdirSync(dirname(o.path), { recursive: true }); writeFileSync(o.path, pending.map((b) => JSON.stringify(b)).join('\n')); };
  return {
    enqueue(b) { pending.push(b); if (pending.length > o.maxItems) pending = pending.slice(pending.length - o.maxItems); persist(); },
    size() { return pending.length; },
    async drain(flush) {
      while (pending.length) {
        await flush(pending[0]);   // throws on failure → loop stops, item kept
        pending.shift(); persist();
      }
    },
  };
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(agent): file-backed offline buffer (drop-oldest cap)`.

---

## Task 4: Orchestrator `runCycle` + entrypoint (Vitest)

**Files:** Create `runtime.ts`, `index.ts`; test `__tests__/runtime.spec.ts`.

- [ ] **Step 1: Failing test** — one cycle syncs, polls, buffers, flushes, heartbeats:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { runCycle } from '../runtime';

describe('runCycle', () => {
  it('syncs → polls → enqueues → drains → heartbeats', async () => {
    const client = {
      syncDevices: vi.fn().mockResolvedValue([{ id: 'a', name: 'A', ipAddress: '10.0.0.1' }]),
      ingest: vi.fn().mockResolvedValue(undefined), heartbeat: vi.fn().mockResolvedValue(undefined),
    };
    const buf = { enqueue: vi.fn(), drain: vi.fn().mockImplementation(async (f: any) => f({ checks: [], metrics: [] })), size: () => 0 };
    const probe = async () => ({ ok: true, latencyMs: 3 });
    await runCycle({ client: client as any, buffer: buf as any, probe, concurrency: 4 });
    expect(client.syncDevices).toHaveBeenCalled();
    expect(buf.enqueue).toHaveBeenCalledTimes(1);
    expect(buf.drain).toHaveBeenCalledWith(client.ingest);
    expect(client.heartbeat).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `runtime.ts`:
```typescript
import type { ProbeResult } from '@nodescope/probe';
import type { AgentClient } from './api-client';
import type { Buffer } from './buffer';
import { reachabilityCollector, pollDevices } from './poller';

export async function runCycle(deps: { client: AgentClient; buffer: Buffer; probe: (ip: string) => Promise<ProbeResult>; concurrency: number }): Promise<void> {
  const devices = await deps.client.syncDevices();
  const batch = await pollDevices(devices, [reachabilityCollector(deps.probe)], deps.concurrency);
  deps.buffer.enqueue(batch);
  await deps.buffer.drain(deps.client.ingest);
  await deps.client.heartbeat();
}
```
`index.ts` (the service entrypoint, glue — verified by the Phase-D e2e and manual smoke, not unit-tested):
```typescript
import { loadConfig } from './config';
import { loadCredentials, saveCredentials } from './credentials';
import { enroll } from './enroll';
import { createAgentClient } from './api-client';
import { createBuffer } from './buffer';
import { probeFromConfig } from './poller';
import { runCycle } from './runtime';
import { platform, hostname } from 'node:os';

async function main() {
  const cfg = loadConfig();
  const credPath = process.env.NODESCOPE_AGENT_CREDENTIALS ?? '/etc/nodescope-agent/credentials.json';
  let creds = loadCredentials(credPath);
  if (!creds && process.env.NODESCOPE_AGENT_ENROLL_CODE) {
    creds = await enroll({ apiUrl: cfg.apiUrl, code: process.env.NODESCOPE_AGENT_ENROLL_CODE, name: hostname(), platform: platform(), version: process.env.npm_package_version ?? '0.0.0' });
    saveCredentials(credPath, creds);
  }
  if (!creds) throw new Error('Not enrolled: provide NODESCOPE_AGENT_ENROLL_CODE or run `nodescope-agent enroll`');
  const client = createAgentClient({ apiUrl: cfg.apiUrl, token: creds.token });
  const buffer = createBuffer({ path: process.env.NODESCOPE_AGENT_QUEUE ?? '/var/lib/nodescope-agent/queue.jsonl', maxItems: 5000 });
  const probe = probeFromConfig(cfg);
  const tick = () => runCycle({ client, buffer, probe, concurrency: cfg.concurrency }).catch((e) => console.error('[agent] cycle error', e));
  setInterval(tick, cfg.probeIntervalMs); void tick();
}
void main();
```

- [ ] **Step 3: Run → PASS.** Commit `feat(agent): orchestrator cycle + service entrypoint`.

---

## Task 5: Phase gate

- [ ] **Step 1: Suite.** `cd apps/agent && npm test` → green (client, poller, buffer, runtime).
- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` → PASS.
- [ ] **Step 3: Manual smoke (after Phase C/D):** with a real enrolled agent → it syncs devices, probes, and `device-status` reflects results; kill the API mid-run → batches buffer to the queue file and flush on reconnect.
- [ ] **Step 4: Docs (Rule 10).** `apps/agent/README.md`: the loop (sync→poll→push), the collector seam, the offline buffer + env (`NODESCOPE_AGENT_*`).
- [ ] **Step 5: Commit** `docs: record Spec 8 agent poll/buffer/push (Phase B)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** token-authed sync/ingest/heartbeat (§7, §9) ✓ Task 1; collector seam + reachability collector (§7) ✓ Task 2; concurrency-capped poll (§5, §7) ✓ Task 2; persistent offline buffer + drop-oldest + keep-on-failure (§8) ✓ Task 3; orchestrator loop sync→poll→push→heartbeat + first-run enroll wiring (§5, §6) ✓ Task 4.
- **Deferred (correctly NOT here):** SNMP collector (Spec 9, registers on this seam); server endpoints + registry + guard (Phase C/D); installers (Phase D). Exponential **backoff timing** between cycles is the `setInterval` cadence; per-batch retry/backoff is the next-cycle re-drain (kept items) — explicit backoff escalation is a refinement.
- **Placeholder scan:** none — concrete code/commands. `index.ts` is glue (e2e/manual-verified), with all logic in unit-tested `runCycle`/collectors/buffer.
- **Type consistency:** `AgentClient` (`syncDevices`/`ingest`/`heartbeat`) ↔ `runCycle`; `Collector`/`CollectResult` ↔ Spec 9; `IngestBatchDto`/`StatusCheckDto`/`MetricSampleDto`/`AgentDeviceDto` from Spec 7/Phase A; `probeFromConfig` uses `AgentConfig` + `@nodescope/probe`; `Buffer.drain(flush)` takes `client.ingest`.
- **Test-config compliance:** all Vitest node; mocked `fetch`/probe/client; buffer uses a tmp file (persistence across a fresh `createBuffer`).
- **Integration points to verify during execution:** the `x-agent-token` header name matches Phase C/D's `AgentTokenGuard`; default credential/queue paths per OS (Phase D installers set them); `fetch` is global (Node ≥18).
