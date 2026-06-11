# Spec 8 Phase A — Shared Probe, Agent Scaffold & Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Spec 7's `probe.ts` into a shared `@nodescope/probe` package, scaffold the `apps/agent` Node/TS daemon (config + `0600` credentials store), and implement first-run enrollment (org code → per-agent token, persisted). No polling/push yet.

**Architecture:** A new workspace package `packages/probe` holds `icmpProbe`/`tcpProbe`/`probeDevice`; the API's Spec 7 prober re-imports it (DRY). `apps/agent` is a standalone TS package (Vitest); `config.ts` loads an `AgentConfig` from a JSON file + env, `credentials.ts` reads/writes the per-agent token to a separate `0600` file, and `enroll.ts` exchanges an enrollment code for `{ agentId, token }`.

**Tech Stack:** TypeScript, Node (`net`/`fs`/`child_process`), Vitest; `@nodescope/shared`.

**Depends on:**
- **Spec 7** — `apps/api/src/monitoring/prober/probe.ts` (to extract) + its `prober.service.ts` import.
- Spec: `docs/superpowers/specs/2026-06-11-spec8-agent-core-design.md` (§4, §5, §6, §11).

> Poller + buffer (Phase B); server registry + token auth (Phase C); agent-facing endpoints + UI + installers (Phase D). The agent here is tested against **mocked HTTP**; the real endpoints land in C/D, exercised e2e in D.

---

## File Structure

**Create:**
- `packages/probe/{package.json,tsconfig.json,src/index.ts}` — `@nodescope/probe`
- `apps/agent/{package.json,tsconfig.json,vitest.config.ts}`
- `apps/agent/src/{config.ts,credentials.ts,enroll.ts}`
- tests `apps/agent/src/__tests__/*.spec.ts`
- `packages/shared/src/types/agent.types.ts` — agent DTOs

**Modify:**
- `apps/api/src/monitoring/prober/prober.service.ts` — import probe from `@nodescope/probe`
- (move) `apps/api/src/monitoring/prober/probe.ts` + its test → `packages/probe`
- root workspace config (`package.json` workspaces / `pnpm-workspace.yaml`) — add the two packages

---

## Task 1: Extract `@nodescope/probe`

**Files:** Create `packages/probe/*`; modify Spec 7's prober import; move the probe test.

- [ ] **Step 1: Create the package.** `packages/probe/package.json`:
```json
{ "name": "@nodescope/probe", "version": "0.0.0", "type": "module", "main": "dist/index.js", "types": "dist/index.d.ts",
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" } }
```
Add `packages/probe` to the root workspace list. `packages/probe/tsconfig.json` mirrors `packages/shared`'s.

- [ ] **Step 2: Move the probe.** Move `apps/api/src/monitoring/prober/probe.ts` → `packages/probe/src/index.ts` (unchanged: `ProbeResult`, `tcpProbe`, `icmpProbe`, `probeDevice`). Move its test (`probe.spec.ts`) → `packages/probe/src/__tests__/index.spec.ts`, importing from `../index`.

- [ ] **Step 3: Re-point Spec 7's prober.** In `apps/api/src/monitoring/prober/prober.service.ts`, change `import { probeDevice, ProbeResult } from './probe'` → `from '@nodescope/probe'`. Add `@nodescope/probe` to `apps/api/package.json` deps.

- [ ] **Step 4: Run both → PASS.** `cd packages/probe && npm run build && npm test`; `cd apps/api && npx tsc --noEmit && npm run test:unit -- prober.service`. Commit `refactor: extract @nodescope/probe (shared by API prober + agent)`.

---

## Task 2: Agent scaffold + `config.ts` (Vitest)

**Files:** Create `apps/agent/*`, `apps/agent/src/config.ts`; test `apps/agent/src/__tests__/config.spec.ts`.

- [ ] **Step 1: Scaffold `apps/agent`.** `package.json`:
```json
{ "name": "@nodescope/agent", "version": "0.0.0", "type": "module", "bin": { "nodescope-agent": "dist/index.js" },
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
  "dependencies": { "@nodescope/probe": "*", "@nodescope/shared": "*" } }
```
`tsconfig.json` (NodeNext) + `vitest.config.ts` (`environment: 'node'`). Add `apps/agent` to the workspace.

- [ ] **Step 2: Failing test** `config.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../config';

describe('loadConfig', () => {
  it('reads a config file and applies env overrides + defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-'));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ apiUrl: 'http://host/api', probeIntervalMs: 15000 }));
    const cfg = loadConfig({ configPath: join(dir, 'config.json'), env: { NODESCOPE_AGENT_CONCURRENCY: '8' } });
    expect(cfg.apiUrl).toBe('http://host/api');
    expect(cfg.probeIntervalMs).toBe(15000);
    expect(cfg.concurrency).toBe(8);          // env override
    expect(cfg.ports).toEqual([443, 80, 22]); // default
    expect(cfg.syncIntervalMs).toBe(300000);  // default
  });
});
```

- [ ] **Step 3: Run → FAIL**, then implement `config.ts`:
```typescript
import { readFileSync } from 'node:fs';

export interface AgentConfig {
  apiUrl: string; syncIntervalMs: number; probeIntervalMs: number;
  concurrency: number; ports: number[]; icmpEnabled: boolean; timeoutMs: number;
}
const num = (v: string | undefined, d: number) => (v != null ? Number(v) : d);

export function loadConfig(opts?: { configPath?: string; env?: Record<string, string | undefined> }): AgentConfig {
  const env = opts?.env ?? process.env;
  const path = opts?.configPath ?? env.NODESCOPE_AGENT_CONFIG ?? '/etc/nodescope-agent/config.json';
  let file: Partial<AgentConfig> = {};
  try { file = JSON.parse(readFileSync(path, 'utf8')); } catch { /* defaults */ }
  return {
    apiUrl: env.NODESCOPE_AGENT_API_URL ?? file.apiUrl ?? 'http://localhost:3000/api',
    syncIntervalMs: num(env.NODESCOPE_AGENT_SYNC_INTERVAL_MS, file.syncIntervalMs ?? 300000),
    probeIntervalMs: num(env.NODESCOPE_AGENT_PROBE_INTERVAL_MS, file.probeIntervalMs ?? 30000),
    concurrency: num(env.NODESCOPE_AGENT_CONCURRENCY, file.concurrency ?? 20),
    ports: (env.NODESCOPE_AGENT_PORTS ?? file.ports?.join(',') ?? '443,80,22').split(',').map((p) => Number(String(p).trim())),
    icmpEnabled: (env.NODESCOPE_AGENT_ICMP ?? String(file.icmpEnabled ?? true)) !== 'false',
    timeoutMs: num(env.NODESCOPE_AGENT_TIMEOUT_MS, file.timeoutMs ?? 2000),
  };
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(agent): scaffold + config loader`.

---

## Task 3: Credentials store + enrollment (Vitest)

**Files:** Create `apps/agent/src/{credentials.ts,enroll.ts}`; `packages/shared/src/types/agent.types.ts`; tests.

- [ ] **Step 1: Shared agent DTOs** `agent.types.ts` (re-export from the shared index):
```typescript
export interface AgentDeviceDto { id: string; name: string; ipAddress: string; }
export interface AgentEnrollRequest { code: string; name: string; platform: string; version: string; }
export interface AgentEnrollResponse { agentId: string; token: string; }
```

- [ ] **Step 2: Failing test** `credentials.spec.ts` — round-trips and writes `0600`:
```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveCredentials, loadCredentials } from '../credentials';

describe('credentials', () => {
  it('persists and reloads, mode 0600', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'cred-')), 'credentials.json');
    saveCredentials(path, { agentId: 'a', token: 't' });
    expect(loadCredentials(path)).toEqual({ agentId: 'a', token: 't' });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadCredentials(join(tmpdir(), 'nope.json'))).toBeNull();
  });
});
```

- [ ] **Step 3: Run → FAIL**, then implement `credentials.ts`:
```typescript
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Credentials { agentId: string; token: string; }

export function saveCredentials(path: string, c: Credentials): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(c), { mode: 0o600 });
}
export function loadCredentials(path: string): Credentials | null {
  try { return JSON.parse(readFileSync(path, 'utf8')) as Credentials; } catch { return null; }
}
```

- [ ] **Step 4: Failing test** `enroll.spec.ts` (mocked fetch):
```typescript
import { describe, it, expect, vi } from 'vitest';
import { enroll } from '../enroll';

describe('enroll', () => {
  it('POSTs the code and returns credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { agentId: 'a1', token: 'tok' }, timestamp: '' }) });
    const creds = await enroll({ apiUrl: 'http://h/api', code: 'CODE', name: 'edge-1', platform: 'linux', version: '0.0.0', fetchImpl: fetchMock });
    expect(creds).toEqual({ agentId: 'a1', token: 'tok' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://h/api/v1/monitoring/agent/enroll');
    expect(JSON.parse(init.body)).toMatchObject({ code: 'CODE', name: 'edge-1', platform: 'linux' });
  });
});
```

- [ ] **Step 5: Run → FAIL**, then implement `enroll.ts`:
```typescript
import type { AgentEnrollResponse } from '@nodescope/shared';
import type { Credentials } from './credentials';

export async function enroll(o: { apiUrl: string; code: string; name: string; platform: string; version: string; fetchImpl?: typeof fetch }): Promise<Credentials> {
  const f = o.fetchImpl ?? fetch;
  const res = await f(`${o.apiUrl}/v1/monitoring/agent/enroll`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: o.code, name: o.name, platform: o.platform, version: o.version }),
  });
  if (!res.ok) throw new Error(`enroll failed: ${res.status}`);
  const env = await res.json() as { success: boolean; data: AgentEnrollResponse };
  return { agentId: env.data.agentId, token: env.data.token };
}
```

- [ ] **Step 6: Run → PASS.** Commit `feat(agent): credentials store + enrollment`.

---

## Task 4: Phase gate

- [ ] **Step 1: Suites.** `cd packages/probe && npm test`; `cd apps/agent && npm test`; `cd apps/api && npm run test:unit -- prober.service` → green.
- [ ] **Step 2: Typecheck.** `cd apps/agent && npx tsc --noEmit` → PASS.
- [ ] **Step 3: Docs (Rule 10).** New `apps/agent/README.md` stub (config + enroll); note `@nodescope/probe` is now shared (SAD/CLAUDE.md).
- [ ] **Step 4: Commit** `docs: record Spec 8 probe extraction + agent scaffold (Phase A)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** `@nodescope/probe` extraction, shared (§4, §5) ✓ Task 1; agent scaffold + config + `0600` credentials (§5) ✓ Tasks 2–3; enrollment exchange (§6) ✓ Task 3; agent DTOs (§11) ✓ Task 3.
- **Deferred (correctly NOT here):** the poll/collector/buffer/push loop (Phase B); the server registry, codes, token guard, ingest extension (Phase C); agent-facing endpoints + management UI + installers + e2e (Phase D).
- **Placeholder scan:** none — concrete code/commands.
- **Type consistency:** `AgentConfig` (config) ↔ Phase B poller/buffer; `Credentials` (credentials) ↔ `enroll` return ↔ Phase B client; `AgentDeviceDto`/`AgentEnrollRequest`/`AgentEnrollResponse` are the agent↔server contract Phases C/D implement; `@nodescope/probe` `probeDevice`/`ProbeResult` reused by Phase B + the (unchanged-behavior) Spec 7 prober.
- **Test-config compliance:** all Vitest node; agent tests use tmp dirs + mocked `fetch`; the moved probe test runs in the new package; the API prober test stays green after the import swap.
- **Integration points to verify during execution:** the repo's workspace manager (npm/pnpm) for adding `packages/probe` + `apps/agent`; the shared package's build/export convention; that moving `probe.ts` doesn't orphan other Spec 7 importers (only `prober.service.ts` imported it).
