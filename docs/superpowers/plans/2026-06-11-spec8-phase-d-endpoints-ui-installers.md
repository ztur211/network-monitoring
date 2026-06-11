# Spec 8 Phase D — Endpoints, Management UI & Installers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the agent-facing endpoints (`enroll`/`devices`/`heartbeat`), the OWNER/ADMIN management endpoints (`enrollment-code`/list/`revoke`/delete), a minimal Agents settings UI, and the cross-platform binary build + service installers — completing the Agent Core end-to-end.

**Architecture:** `agent-ingest.controller` serves the agent (enroll is code-authed; devices/heartbeat use `AgentTokenGuard`). `agents.controller` serves admins (session + `@OrgRoles`). The web app gains an Agents settings screen (generate code, list, revoke). The agent package gains a binary build (Node SEA / `pkg`) + per-OS install scripts published to Spaces.

**Tech Stack:** NestJS, Prisma, Jest (e2e); React-Native-Web (web app), Vitest/RTL; Node SEA / `pkg`, systemd/sc/launchd.

**Depends on:** Phase C (`AgentTokenService`, `AgentTokenGuard`, `AgentRepository`), Phase A/B (the agent binary), Spec 4 (`DevicesService`), F1a (`@OrgRoles`/`@OrgId`/`@CurrentMember`). Spec: `2026-06-11-spec8-agent-core-design.md` (§7, §9, §10).

> Final Spec 8 phase. Ends with the cross-plan review over A–D.

---

## File Structure

**Create:**
- `apps/api/src/agents/agent-ingest.controller.ts` — enroll / devices / heartbeat
- `apps/api/src/agents/agents.controller.ts` + `agents.service.ts` — management
- `apps/web/.../screens/AgentsSettings.tsx` (+ client calls) — the UI
- `apps/agent/scripts/{build-binaries.*, install-linux.sh, install-windows.ps1, install-macos.sh}` + service templates
- tests `agents/__tests__/{agent-ingest.e2e.ts, agents.controller.e2e.ts}`, `apps/web/.../__tests__/AgentsSettings.spec.tsx`

**Modify:**
- `apps/api/src/agents/agent.repository.ts` — `listOrgDevicesWithIp`
- `packages/shared/src/types/agent.types.ts` — `AgentDto`
- `apps/api/src/agents/agents.module.ts` — controllers + service

---

## Task 1: Agent-facing endpoints (Jest e2e)

**Files:** Create `agent-ingest.controller.ts`; modify `agent.repository.ts`; test `agents/__tests__/agent-ingest.e2e.ts`.

- [ ] **Step 1: Failing e2e** — enroll with a code, then sync devices with the token:
```typescript
it('enroll → sync the org IP-d devices', async () => {
  const code = await agentTokens.generateEnrollmentCode(orgId, memberId);
  const { token } = (await request(srv).post('/v1/monitoring/agent/enroll').send({ code, name: 'e', platform: 'linux', version: '0' }).expect(201)).body.data;
  const devs = (await request(srv).get('/v1/monitoring/agent/devices').set('x-agent-token', token).expect(200)).body.data;
  expect(devs.map((d: any) => d.id)).toContain(ipDeviceId);     // device with an ipAddress
  expect(devs.find((d: any) => d.id === noIpDeviceId)).toBeUndefined();
});
it('rejects sync without a valid token', () =>
  request(srv).get('/v1/monitoring/agent/devices').set('x-agent-token', 'bad').expect(401));
```

- [ ] **Step 2: Run → FAIL**, then add `listOrgDevicesWithIp` to `agent.repository.ts`:
```typescript
listOrgDevicesWithIp(organizationId: string): Promise<{ id: string; name: string; ipAddress: string }[]> {
  return this.prisma.device.findMany({ where: { organizationId, ipAddress: { not: null } }, select: { id: true, name: true, ipAddress: true } }) as any;
}
```
Implement `agent-ingest.controller.ts`:
```typescript
import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AgentEnrollRequest, AgentDeviceDto } from '@nodescope/shared';
import { AgentTokenService } from './agent-token.service';
import { AgentRepository } from './agent.repository';
import { AgentTokenGuard } from './agent-token.guard';

@Controller('v1/monitoring/agent')
export class AgentIngestController {
  constructor(private readonly tokens: AgentTokenService, private readonly repo: AgentRepository) {}

  @Post('enroll')
  enroll(@Body() body: AgentEnrollRequest) {
    return this.tokens.enroll(body.code, { name: body.name, platform: body.platform, version: body.version });
  }

  @Get('devices')
  @UseGuards(AgentTokenGuard)
  devices(@Req() req: { agent: { orgId: string } }): Promise<AgentDeviceDto[]> {
    return this.repo.listOrgDevicesWithIp(req.agent.orgId);
  }

  @Post('heartbeat')
  @UseGuards(AgentTokenGuard)
  @HttpCode(204)
  heartbeat() { /* AgentTokenGuard already bumped lastSeenAt */ }
}
```
Register in `agents.module.ts`.

- [ ] **Step 3: Run → PASS.** Commit `feat(api): agent enroll/devices/heartbeat endpoints`.

---

## Task 2: Management endpoints (Jest e2e)

**Files:** Create `agents.controller.ts`, `agents.service.ts`; `AgentDto` in shared; test `agents/__tests__/agents.controller.e2e.ts`.

- [ ] **Step 1: `AgentDto`** in `agent.types.ts`:
```typescript
export interface AgentDto { id: string; name: string; platform: string | null; version: string | null; status: 'PENDING' | 'APPROVED' | 'REVOKED'; lastSeenAt: string | null; }
```

- [ ] **Step 2: Failing e2e** — OWNER lists/generates/revokes; a revoked agent is rejected:
```typescript
it('OWNER generates a code, lists agents, revokes one', async () => {
  const { code } = (await request(srv).post('/v1/agents/enrollment-code').set(ownerAuth).expect(201)).body.data;
  const { token, agentId } = (await request(srv).post('/v1/monitoring/agent/enroll').send({ code, name: 'e', platform: 'linux', version: '0' }).expect(201)).body.data;
  const list = (await request(srv).get('/v1/agents').set(ownerAuth).expect(200)).body.data;
  expect(list.find((a: any) => a.id === agentId).status).toBe('APPROVED');
  await request(srv).post(`/v1/agents/${agentId}/revoke`).set(ownerAuth).expect(200);
  await request(srv).get('/v1/monitoring/agent/devices').set('x-agent-token', token).expect(401); // revoked
});
it('a MEMBER cannot manage agents', () => request(srv).get('/v1/agents').set(memberAuth).expect(403));
```

- [ ] **Step 3: Run → FAIL**, then implement `agents.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { AgentDto } from '@nodescope/shared';
import { AgentRepository } from './agent.repository';
import { AgentTokenService } from './agent-token.service';

@Injectable()
export class AgentsService {
  constructor(private readonly repo: AgentRepository, private readonly tokens: AgentTokenService) {}
  async generateCode(orgId: string, memberId: string) { return { code: await this.tokens.generateEnrollmentCode(orgId, memberId) }; }
  async list(orgId: string): Promise<AgentDto[]> {
    return (await this.repo.listByOrg(orgId)).map((a) => ({ id: a.id, name: a.name, platform: a.platform, version: a.version, status: a.status, lastSeenAt: a.lastSeenAt?.toISOString() ?? null }));
  }
  revoke(id: string) { return this.repo.setStatus(id, 'REVOKED'); }
  remove(id: string) { return this.repo.delete(id); }
}
```
`agents.controller.ts` (session-authed, OWNER/ADMIN):
```typescript
@Controller('v1/agents')
export class AgentsController {
  constructor(private readonly svc: AgentsService) {}
  @Post('enrollment-code') @OrgRoles('OWNER', 'ADMIN')
  code(@OrgId() orgId: string, @CurrentMember() m: { id: string }) { return this.svc.generateCode(orgId, m.id); }
  @Get() @OrgRoles('OWNER', 'ADMIN')
  list(@OrgId() orgId: string) { return this.svc.list(orgId); }
  @Post(':id/revoke') @OrgRoles('OWNER', 'ADMIN')
  revoke(@Param('id') id: string) { return this.svc.revoke(id); }
  @Delete(':id') @OrgRoles('OWNER', 'ADMIN')
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}
```
(Revoke/delete are org-scoped: the controller resolves the agent within `@OrgId` — add an org check in the service if the repo lookup isn't already org-filtered; `findById` + assert `organizationId === orgId` → else 404.) Write `ChangeLog` on revoke/delete.

- [ ] **Step 4: Run → PASS.** Commit `feat(api): agent management endpoints (code/list/revoke/delete)`.

---

## Task 3: Agents settings UI (Vitest + RTL)

**Files:** Create `apps/web/.../screens/AgentsSettings.tsx` (+ a client call module); test `__tests__/AgentsSettings.spec.tsx`.

- [ ] **Step 1: Failing test** (mocked client): lists agents + generates a code:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentsSettings } from '../screens/AgentsSettings';

const client = {
  listAgents: vi.fn().mockResolvedValue([{ id: 'a', name: 'edge-1', platform: 'linux', version: '0.0.0', status: 'APPROVED', lastSeenAt: null }]),
  generateAgentCode: vi.fn().mockResolvedValue({ code: 'NEWCODE' }),
  revokeAgent: vi.fn().mockResolvedValue(undefined),
};

it('lists agents and shows a generated code', async () => {
  render(<AgentsSettings client={client as any} />);
  await waitFor(() => expect(screen.getByText('edge-1')).toBeTruthy());
  fireEvent.click(screen.getByText(/generate enrollment code/i));
  await waitFor(() => expect(screen.getByText(/NEWCODE/)).toBeTruthy());
});
```

- [ ] **Step 2: Run → FAIL**, then implement `AgentsSettings.tsx` (RN-Web; presentational, client-injected):
```tsx
import { useEffect, useState } from 'react';
import { View, Text, Button, FlatList } from 'react-native';

export function AgentsSettings({ client }: { client: { listAgents(): Promise<any[]>; generateAgentCode(): Promise<{ code: string }>; revokeAgent(id: string): Promise<void> } }) {
  const [agents, setAgents] = useState<any[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const reload = () => client.listAgents().then(setAgents);
  useEffect(() => { reload(); }, []);
  return (
    <View>
      <Button title="Generate enrollment code" onPress={() => client.generateAgentCode().then((r) => setCode(r.code))} />
      {code && <Text>Enrollment code: {code} (install with: nodescope-agent enroll --code {code})</Text>}
      <FlatList data={agents} keyExtractor={(a) => a.id} renderItem={({ item }) => (
        <View>
          <Text>{item.name} · {item.platform} · {item.status} · {item.lastSeenAt ?? 'never'}</Text>
          <Button title="Revoke" onPress={() => client.revokeAgent(item.id).then(reload)} />
        </View>
      )} />
    </View>
  );
}
```
Add `listAgents`/`generateAgentCode`/`revokeAgent` to the web app's API client and mount `AgentsSettings` in the org settings nav (following the existing settings screens).

- [ ] **Step 3: Run → PASS.** Commit `feat(web): Agents settings (generate code, list, revoke)`.

---

## Task 4: Binary build + cross-platform installers

**Files:** Create `apps/agent/scripts/*` + service templates.

- [ ] **Step 1: Binary build.** Add `apps/agent` script `"build:bin": "node --experimental-sea-config sea-config.json"` (Node SEA) or a `pkg` target producing `dist/nodescope-agent-{linux,win.exe,macos}`. Add a `sea-config.json` / `pkg` config. Verify: `cd apps/agent && npm run build && npm run build:bin && ./dist/nodescope-agent --version` prints the version.

- [ ] **Step 2: Linux installer** `scripts/install-linux.sh`: download the binary to `/usr/local/bin/nodescope-agent`, write `/etc/systemd/system/nodescope-agent.service` (a unit running it with `NODESCOPE_AGENT_*` env / config path), `systemctl enable --now`. Include the `.service` template.

- [ ] **Step 3: Windows + macOS** `scripts/install-windows.ps1` (`sc.exe create NodeScopeAgent binPath=…` or a bundled service wrapper) and `scripts/install-macos.sh` (a `launchd` plist in `/Library/LaunchDaemons`). Each takes `--url` + `--code` and runs `nodescope-agent enroll` once, then starts the service.

- [ ] **Step 4: Publish.** A CI job builds the three binaries + uploads them (and the install scripts) to the **Spaces bucket**; the Agents UI's install one-liner points at them. Commit `feat(agent): single-binary build + cross-platform service installers`.

---

## Task 5: Phase gate

- [ ] **Step 1: Suites.** `cd apps/api && npm run test:e2e -- agent` and `cd apps/web && npm test -- AgentsSettings` and `cd apps/agent && npm test` → green.
- [ ] **Step 2: Typecheck** across `apps/api`/`apps/web`/`apps/agent` → PASS.
- [ ] **Step 3: Manual end-to-end:** in the web app generate a code → install the agent on a box (`install-linux.sh --url … --code …`) → it enrolls + appears in the Agents list (last-seen updating) → its probed devices' status shows in Spec 4's 3D markers/panel → revoke → the agent's calls 401 and it stops reporting.
- [ ] **Step 4: Docs (Rule 10).** API Design Document: `/v1/agents/*` + `/v1/monitoring/agent/*`; `apps/agent/README.md` (build/install/enroll); `deploy/README.md` (installing the agent per OS from Spaces); update the roadmap doc (Desktop Agent: Core shipped).
- [ ] **Step 5: Commit** `docs: record Spec 8 endpoints + UI + installers (Phase D) + agent complete`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** agent enroll/devices/heartbeat (§7, §9) ✓ Task 1; whole-org IP-d device sync (§7) ✓ Task 1; management code/list/revoke/delete, OWNER/ADMIN (§9, §10) ✓ Task 2; Agents UI (generate code, list, status/last-seen, revoke) (§10) ✓ Task 3; single-binary build + Win/Linux/mac installers + Spaces (§5, §10) ✓ Task 4.
- **Deferred (correctly per spec):** SNMP (Spec 9); macOS signing/notarization, auto-update, explicit-approval policy, per-agent site scope (§3, §15).
- **Placeholder scan:** none — concrete code/commands. Installers are scripts/templates (build-and-run-verified, not unit-tested — appropriate).
- **Type consistency:** `AgentDto` (shared) ↔ `AgentsService.list` ↔ UI; `AgentEnrollRequest`/`AgentDeviceDto` (Phase A) ↔ `AgentIngestController`; `AgentTokenService`/`AgentTokenGuard`/`AgentRepository` (Phase C); `listOrgDevicesWithIp` added here; `@OrgRoles`/`@OrgId`/`@CurrentMember` from F1a.
- **Test-config compliance:** api e2e (F1a OWNER/MEMBER auth helpers + `x-agent-token`); web RTL with a mocked client; agent binary smoke is a build+`--version` run.
- **Integration points to verify during execution:** the web app's settings nav + API-client patterns; the chosen packaging tool (SEA vs `pkg`) and its per-OS output; org-scoping the revoke/delete lookups; the Spaces upload credentials in CI.

---

# Spec 8 — cross-plan self-review (all four phases)

- **Spec coverage (full):** §4 architecture (shared probe, agent package, server agents module) → A/B/C/D ✓ · §5 agent runtime/config/credentials/binary → A (config/creds) + B (loop) + D (binary/installers) ✓ · §6 enrollment + identity → A (client) + C (service/models) + D (endpoint) ✓ · §7 device sync + poll + collector seam → B (poller/seam) + D (devices endpoint) ✓ · §8 push + offline buffer → B ✓ · §9 server agents module (registry, guard, ingest extension, last-seen) → C + D ✓ · §10 management UI + installers → D ✓ · §11 public interface (device-sync payload, collector seam, agent identity, ingest) → A (DTOs) + B (seam) + C (identity) for Spec 9 ✓ · §12 security (per-agent hashed tokens, single-use codes, least privilege, 0600 creds) → A/C ✓ · §13 testing → every phase ✓.
- **Build-green order:** A (shared probe + scaffold + enroll, mocked HTTP) → B (poll/buffer/push, mocked HTTP) → C (registry + token auth + ingest widening) → D (endpoints + UI + installers + e2e). Each ends green; the agent (A/B) is tested against mocks, then D's e2e exercises the real server path.
- **Cross-phase type consistency:** `AgentConfig`/`Credentials` (A) → B; `@nodescope/probe` `probeDevice`/`ProbeResult` (A extraction) → B poller + Spec 7 prober (unchanged behavior); `Collector`/`CollectResult` (B) → Spec 9; `AgentClient` (B) ↔ the server endpoints (D); `AgentEnrollRequest`/`AgentEnrollResponse`/`AgentDeviceDto`/`AgentDto` (shared) span agent↔server; `AgentTokenService.verifyToken → {orgId, agentId}` ↔ `AgentTokenGuard` + the widened ingest guard; `source = agent:<id>` flows into Spec 7's `DeviceStatus`.
- **Flagged for execution:** the workspace manager + shared-package wiring (A); `x-agent-token` header parity (B↔C/D); the `ChangeLog` CHECK + `NodeScopeException` codes (C); `MonitoringModule`↔`AgentModule` import (no cycle) (C); the packaging tool + Spaces CI creds + the web settings nav (D). All localized.
- **Boundary to Spec 9 (Agent SNMP):** it (a) extends `AgentDeviceDto` with `snmp` config in the device-sync payload, (b) registers an `snmpCollector` on the Phase-B collector seam, (c) pushes SNMP samples through the unchanged generic `reportMetric`/ingest. No Core restructuring; only the device-sync DTO + the collector list grow.
