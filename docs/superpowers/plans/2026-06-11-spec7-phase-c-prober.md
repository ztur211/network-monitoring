# Spec 7 Phase C — Embedded ICMP/TCP Prober Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the embedded collector — pure `tcpProbe`/`icmpProbe`/`probeDevice`, and a `ProberService` that (when enabled) polls devices with an `ipAddress` on an interval, concurrency-capped, feeding `IngestService.reportStatusCheck`. **Off by default** (cloud uses the Agent; self-host enables it).

**Architecture:** `probe.ts` is dependency-free — `tcpProbe` via `node:net`, `icmpProbe` by spawning the system `ping` and parsing RTT. `probeDevice` tries ICMP (if enabled) then TCP-connect over a port set. `ProberService` extracts a pure `runProbeCycle` (testable with a mocked probe + ingest) from a `setInterval` scheduler gated on `MONITORING_PROBER_ENABLED`.

**Tech Stack:** NestJS 11, Node `net`/`child_process`, Jest (unit).

**Depends on:**
- **Phase A** — `IngestService.reportStatusCheck`.
- Existing — `Device.ipAddress`, `PrismaService`.
- Spec: `2026-06-11-spec7-device-monitoring-design.md` (§4 prober approach, §8).

> No new endpoints. Self-host enables `MONITORING_PROBER_ENABLED=true`; the full SNMP/enrollment collector is the Agent spec.

---

## File Structure

**Create:**
- `apps/api/src/monitoring/prober/probe.ts` — `tcpProbe`, `icmpProbe`, `probeDevice`
- `apps/api/src/monitoring/prober/prober.service.ts` — `runProbeCycle`, `mapLimit`, `ProberService`
- tests `monitoring/__tests__/{probe.spec.ts, prober.service.spec.ts}`

**Modify:**
- `apps/api/src/monitoring/monitoring.module.ts` — provide `ProberService`
- `.env.example` — `MONITORING_*` prober env

---

## Task 1: `probe.ts` (Jest unit)

**Files:** Create `prober/probe.ts`; test `monitoring/__tests__/probe.spec.ts`.

- [ ] **Step 1: Failing test** — `tcpProbe` succeeds against a live local server, fails against a closed port; `probeDevice` prefers ICMP then falls back to TCP:

```typescript
import { createServer } from 'node:net';
import { tcpProbe, probeDevice } from '../prober/probe';

describe('probe', () => {
  it('tcpProbe ok to a listening port, fail to a closed one', async () => {
    const srv = createServer().listen(0);
    await new Promise((r) => srv.once('listening', r));
    const port = (srv.address() as any).port;
    const ok = await tcpProbe('127.0.0.1', port, 1000);
    expect(ok.ok).toBe(true); expect(ok.latencyMs).toBeGreaterThanOrEqual(0);
    srv.close();
    const fail = await tcpProbe('127.0.0.1', port, 500);
    expect(fail.ok).toBe(false);
  });
  it('probeDevice falls back to TCP when ICMP is disabled', async () => {
    const srv = createServer().listen(0);
    await new Promise((r) => srv.once('listening', r));
    const port = (srv.address() as any).port;
    const r = await probeDevice('127.0.0.1', { icmpEnabled: false, ports: [port], timeoutMs: 1000 });
    expect(r.ok).toBe(true);
    srv.close();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:unit -- probe`.

- [ ] **Step 3: Implement `prober/probe.ts`:**

```typescript
import { createConnection } from 'node:net';
import { execFile } from 'node:child_process';

export interface ProbeResult { ok: boolean; latencyMs?: number }

export function tcpProbe(ip: string, port: number, timeoutMs: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const sock = createConnection({ host: ip, port });
    let settled = false;
    const finish = (ok: boolean) => { if (settled) return; settled = true; sock.destroy(); resolve(ok ? { ok: true, latencyMs: performance.now() - start } : { ok: false }); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

export function icmpProbe(ip: string, timeoutMs: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    // Linux ping: -c 1 one echo, -W timeout (seconds). Spawning avoids holding NET_RAW in the node process.
    execFile('ping', ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), ip], (err, stdout) => {
      if (err) return resolve({ ok: false });
      const m = /time[=<]\s*([\d.]+)\s*ms/.exec(stdout);
      resolve({ ok: true, latencyMs: m ? parseFloat(m[1]) : undefined });
    });
  });
}

export async function probeDevice(ip: string, opts: { icmpEnabled: boolean; ports: number[]; timeoutMs: number }): Promise<ProbeResult> {
  if (opts.icmpEnabled) { const r = await icmpProbe(ip, opts.timeoutMs); if (r.ok) return r; }
  for (const port of opts.ports) { const r = await tcpProbe(ip, port, opts.timeoutMs); if (r.ok) return r; }
  return { ok: false };
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): tcp/icmp device probes`.

---

## Task 2: `ProberService` + `runProbeCycle` (Jest unit)

**Files:** Create `prober/prober.service.ts`; test `monitoring/__tests__/prober.service.spec.ts`.

- [ ] **Step 1: Failing test** — `runProbeCycle` probes each device and reports; the service is a no-op when disabled:

```typescript
import { runProbeCycle, mapLimit } from '../prober/prober.service';

describe('runProbeCycle', () => {
  it('probes every device and reports the result to ingest', async () => {
    const calls: any[] = [];
    const ingest = { reportStatusCheck: async (x: any) => { calls.push(x); } };
    const probe = async (ip: string) => ({ ok: ip !== '10.0.0.2', latencyMs: 5 });
    await runProbeCycle(
      [{ id: 'a', organizationId: 'o', ipAddress: '10.0.0.1' }, { id: 'b', organizationId: 'o', ipAddress: '10.0.0.2' }],
      probe, ingest as any, 2,
    );
    expect(calls).toHaveLength(2);
    expect(calls.find((c) => c.deviceId === 'b').ok).toBe(false);
    expect(calls.every((c) => c.source === 'prober')).toBe(true);
  });
  it('mapLimit runs all items under a concurrency cap', async () => {
    const seen: number[] = [];
    await mapLimit([1, 2, 3, 4, 5], 2, async (n) => { seen.push(n); });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:unit -- prober.service`.

- [ ] **Step 3: Implement `prober/prober.service.ts`:**

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IngestService } from '../ingest/ingest.service';
import { probeDevice, ProbeResult } from './probe';

const cfg = () => ({
  enabled: process.env.MONITORING_PROBER_ENABLED === 'true',
  intervalMs: Number(process.env.MONITORING_PROBE_INTERVAL_MS ?? 30000),
  concurrency: Number(process.env.MONITORING_PROBE_CONCURRENCY ?? 20),
  icmpEnabled: process.env.MONITORING_ICMP_ENABLED !== 'false',
  ports: (process.env.MONITORING_PROBE_PORTS ?? '443,80,22').split(',').map((p) => Number(p.trim())),
  timeoutMs: Number(process.env.MONITORING_PROBE_TIMEOUT_MS ?? 2000),
});

export async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, async () => { while (queue.length) await fn(queue.shift()!); }));
}

export async function runProbeCycle(
  devices: { id: string; organizationId: string; ipAddress: string }[],
  probe: (ip: string) => Promise<ProbeResult>,
  ingest: Pick<IngestService, 'reportStatusCheck'>,
  concurrency: number,
): Promise<void> {
  await mapLimit(devices, concurrency, async (d) => {
    const r = await probe(d.ipAddress);
    await ingest.reportStatusCheck({ organizationId: d.organizationId, deviceId: d.id, ok: r.ok, latencyMs: r.latencyMs, source: 'prober' });
  });
}

@Injectable()
export class ProberService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly prisma: PrismaService, private readonly ingest: IngestService) {}
  onModuleInit(): void {
    const c = cfg();
    if (!c.enabled) return; // OFF by default — cloud uses the Agent
    this.timer = setInterval(() => { void this.cycle(); }, c.intervalMs);
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  async cycle(): Promise<void> {
    const c = cfg();
    const devices = await this.prisma.device.findMany({ where: { ipAddress: { not: null } }, select: { id: true, organizationId: true, ipAddress: true } });
    await runProbeCycle(devices as { id: string; organizationId: string; ipAddress: string }[],
      (ip) => probeDevice(ip, { icmpEnabled: c.icmpEnabled, ports: c.ports, timeoutMs: c.timeoutMs }), this.ingest, c.concurrency);
  }
}
```
Add `ProberService` to `monitoring.module` providers. (On a self-host single-tenant box this probes that org's devices; cloud leaves it off. `setInterval` avoids a `@nestjs/schedule` dependency.)

- [ ] **Step 4: Run → PASS.** Add `MONITORING_*` to `.env.example`:
```bash
# Embedded device prober (self-host / on-network only; cloud uses the Agent)
MONITORING_PROBER_ENABLED=false
MONITORING_PROBE_INTERVAL_MS=30000
MONITORING_PROBE_CONCURRENCY=20
MONITORING_ICMP_ENABLED=true
MONITORING_PROBE_PORTS=443,80,22
MONITORING_PROBE_TIMEOUT_MS=2000
MONITORING_DOWN_THRESHOLD=3
MONITORING_WARN_LATENCY_MS=250
```
Commit `feat(api): embedded prober service (off by default)`.

---

## Task 3: Phase gate

- [ ] **Step 1: Suite.** `cd apps/api && npm run test:unit -- probe prober.service` → green.
- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` → PASS.
- [ ] **Step 3: Manual smoke (self-host):** set `MONITORING_PROBER_ENABLED=true`, seed a device with a reachable `ipAddress`, start the API → within an interval its `DeviceStatus` becomes `UP` and `latency_ms` metrics accrue; stop the target → after `downThreshold` cycles it flips `DOWN` and emits `v1:device:status` (Spec 4 marker turns red). For ICMP, the container needs the `ping` binary (+ `NET_RAW` if ping isn't setuid).
- [ ] **Step 4: Docs (Rule 10).** `deploy/README.md`: enabling the prober (`MONITORING_PROBER_ENABLED`, ICMP/`NET_RAW` note, port set); SAD: the prober is the v1 embedded collector, off by default.
- [ ] **Step 5: Commit** `docs: record Spec 7 embedded prober (Phase C)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** ICMP + TCP-connect probes (§8) ✓ Task 1; TCP fallback over a port set (§8) ✓ Task 1; concurrency-capped scheduled cycle (§4, §8) ✓ Task 2; feeds `reportStatusCheck` with `source:'prober'` (§6) ✓ Task 2; **off by default** via `MONITORING_PROBER_ENABLED` (§8) ✓ Task 2; latency captured (§1, §6) ✓ Tasks 1–2 (RTT in `ProbeResult` → ingest → `latency_ms` metric in Phase A).
- **Deferred (correctly NOT here):** SNMP + rich metrics, enrollment, offline buffering, installers → the Agent spec; HTTP ingest + token → Phase D; stale→`UNKNOWN` sweep (a device that stops being probed keeps its last state until re-checked — a read-time stale check or sweep is a refinement, §15).
- **Placeholder scan:** none — concrete, dependency-free code.
- **Type consistency:** `ProbeResult { ok, latencyMs? }` flows `probe.ts → runProbeCycle → IngestService.reportStatusCheck` (Phase A signature: `{ organizationId, deviceId, ok, latencyMs?, source }`); `probeDevice` opts `{ icmpEnabled, ports, timeoutMs }` ↔ `cfg()`; `mapLimit`/`runProbeCycle` exported for the unit tests.
- **Test-config compliance:** `probe`/`prober.service` are unit tests (real loopback `net` server, no external network, mocked ingest); no DB needed.
- **Integration points to verify during execution:** the container ships the `ping` binary (or set `MONITORING_ICMP_ENABLED=false` for TCP-only); `performance.now()` availability (Node ≥16, fine); whether to add the read-time stale→`UNKNOWN` adjustment to Phase B's `toDto` (recommended follow-up).
