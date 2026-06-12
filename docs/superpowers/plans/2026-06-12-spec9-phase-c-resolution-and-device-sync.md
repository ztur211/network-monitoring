# Spec 9 Phase C — Resolution & Device-Sync Decryption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve each device's effective SNMP credential + OID profile (device override ?? network), **decrypt** the secrets, and attach a `SnmpTargetDto` to Spec 8's agent device-sync — so the agent (Phase D) receives ready-to-use SNMP targets.

**Architecture:** `SnmpService.resolveTarget(orgId, deviceId)` composes `SnmpRepository.deviceWithSnmp` + credential/profile loads + `CryptoService.decrypt` into a `SnmpTargetDto` (or null). `attachTargets` maps it over the agent device list; Spec 8's agent-facing `GET …/agent/devices` calls it. Decryption happens **only here**, into the TLS, per-agent response.

**Tech Stack:** NestJS, Prisma, Jest (integration + e2e).

**Depends on:**
- **Phase A/B** — `SnmpRepository.deviceWithSnmp`/`findCredential`/`findProfile`, `CryptoService`, `SnmpService`.
- **Spec 8** — `AgentDeviceDto`, `AgentIngestController.devices`, `AgentTokenGuard`, `AgentRepository.listOrgDevicesWithIp`.
- Spec: `2026-06-12-spec9-agent-snmp-design.md` (§6 resolution, §7, §10).

> The agent `snmpCollector` consuming this + the UI are Phase D.

---

## File Structure

**Create:** tests `apps/api/src/snmp/__tests__/snmp.resolve.spec.ts`, `agents/__tests__/agent-devices-snmp.e2e.ts`

**Modify:**
- `packages/shared/src/types/agent.types.ts` — `AgentDeviceDto.snmp?` + `SnmpTargetDto`
- `apps/api/src/snmp/snmp.service.ts` — `resolveTarget`, `attachTargets`
- `apps/api/src/agents/agent-ingest.controller.ts` — attach SNMP targets (import the snmp module)

---

## Task 1: `SnmpTargetDto` + `AgentDeviceDto.snmp`

- [ ] **Step 1:** In `agent.types.ts` (Spec 8):
```typescript
export interface SnmpTargetDto {
  version: 'V2C' | 'V3';
  community?: string;
  securityLevel?: string; securityName?: string; authProtocol?: string; authKey?: string; privProtocol?: string; privKey?: string;
  oids: { oid: string; metric: string }[];
  interfaceMetrics: boolean;
}
export interface AgentDeviceDto { id: string; name: string; ipAddress: string; snmp?: SnmpTargetDto } // snmp added
```
`cd packages/shared && npm run build`.

---

## Task 2: `resolveTarget` + `attachTargets` (Jest integration)

**Files:** Modify `snmp.service.ts`; test `snmp/__tests__/snmp.resolve.spec.ts`.

- [ ] **Step 1: Failing test** — network default applies, device override wins, decrypted; no cred → null:
```typescript
it('resolves effective target with decryption; device override wins; null when none', async () => {
  const netCred = await svc.createCredential(orgId, { name: 'net', snmpVersion: 'V2C', community: 'net-comm' });
  const devCred = await svc.createCredential(orgId, { name: 'dev', snmpVersion: 'V2C', community: 'dev-comm' });
  const prof = await svc.createProfile(orgId, { name: 'p', includeInterfaceMetrics: true, entries: [{ oid: '1.3.6.1.2.1.1.3.0', metric: 'uptime' }] });
  const net = await prisma.network.create({ data: { organizationId: orgId, name: 'N', snmpCredentialId: netCred.id, oidProfileId: prof.id } });
  const dev = await prisma.device.create({ data: { organizationId: orgId, name: 'D', category: 'SWITCH', propertyId: siteId, networkId: net.id, ipAddress: '10.0.0.1' } });

  let t = await svc.resolveTarget(orgId, dev.id);            // inherits the network
  expect(t!.community).toBe('net-comm'); expect(t!.interfaceMetrics).toBe(true); expect(t!.oids).toHaveLength(1);

  await prisma.device.update({ where: { id: dev.id }, data: { snmpCredentialId: devCred.id } });
  t = await svc.resolveTarget(orgId, dev.id);                // device override wins
  expect(t!.community).toBe('dev-comm');

  const bare = await prisma.device.create({ data: { organizationId: orgId, name: 'B', category: 'SWITCH', propertyId: siteId, networkId: (await prisma.network.create({ data: { organizationId: orgId, name: 'N2' } })).id, ipAddress: '10.0.0.2' } });
  expect(await svc.resolveTarget(orgId, bare.id)).toBeNull(); // no credential
});
```

- [ ] **Step 2: Run → FAIL**, then add to `snmp.service.ts`:
```typescript
import { AgentDeviceDto, SnmpTargetDto } from '@nodescope/shared';

async resolveTarget(orgId: string, deviceId: string): Promise<SnmpTargetDto | null> {
  const d = await this.repo.deviceWithSnmp(orgId, deviceId);
  if (!d) return null;
  const credId = d.snmpCredentialId ?? d.network?.snmpCredentialId ?? null;
  if (!credId) return null;
  const cred = await this.repo.findCredential(orgId, credId);
  if (!cred) return null;
  const profId = d.oidProfileId ?? d.network?.oidProfileId ?? null;
  const prof = profId ? await this.repo.findProfile(orgId, profId) : null;
  const dec = (b: string | null) => (b ? this.crypto.decrypt(b) : undefined);
  return {
    version: cred.snmpVersion,
    community: dec(cred.communityEnc),
    securityLevel: cred.securityLevel ?? undefined, securityName: cred.securityName ?? undefined,
    authProtocol: cred.authProtocol ?? undefined, authKey: dec(cred.authKeyEnc),
    privProtocol: cred.privProtocol ?? undefined, privKey: dec(cred.privKeyEnc),
    oids: prof?.entries.map((e) => ({ oid: e.oid, metric: e.metric })) ?? [],
    interfaceMetrics: prof?.includeInterfaceMetrics ?? false,
  };
}
async attachTargets(orgId: string, devices: AgentDeviceDto[]): Promise<AgentDeviceDto[]> {
  return Promise.all(devices.map(async (d) => { const snmp = await this.resolveTarget(orgId, d.id); return snmp ? { ...d, snmp } : d; }));
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(api): SNMP target resolution + decryption`.

---

## Task 3: Extend agent device-sync (Jest e2e)

**Files:** Modify `agents/agent-ingest.controller.ts`; test `agents/__tests__/agent-devices-snmp.e2e.ts`.

- [ ] **Step 1: Failing e2e** — the agent device list carries decrypted `snmp` for an assigned device, omits it otherwise:
```typescript
it('includes the resolved snmp target for an assigned device', async () => {
  const code = await agentTokens.generateEnrollmentCode(orgId, memberId);
  const { token } = (await request(srv).post('/v1/monitoring/agent/enroll').send({ code, name: 'e', platform: 'linux', version: '0' }).expect(201)).body.data;
  // assignedDeviceId has a network credential; plainDeviceId has none
  const devs = (await request(srv).get('/v1/monitoring/agent/devices').set('x-agent-token', token).expect(200)).body.data;
  expect(devs.find((d: any) => d.id === assignedDeviceId).snmp.community).toBe('public');
  expect(devs.find((d: any) => d.id === plainDeviceId).snmp).toBeUndefined();
});
```

- [ ] **Step 2: Run → FAIL**, then update `agent-ingest.controller.ts` to attach targets:
```typescript
// inject SnmpService; the devices handler becomes:
@Get('devices')
@UseGuards(AgentTokenGuard)
async devices(@Req() req: { agent: { orgId: string } }): Promise<AgentDeviceDto[]> {
  const base = await this.repo.listOrgDevicesWithIp(req.agent.orgId);
  return this.snmp.attachTargets(req.agent.orgId, base);
}
```
(`AgentModule` imports `SnmpModule`; `SnmpModule` exports `SnmpService`.)

- [ ] **Step 3: Run → PASS.** Commit `feat(api): attach resolved SNMP targets to agent device-sync`.

---

## Task 4: Phase gate

- [ ] **Step 1: Suites.** `cd apps/api && npm run test:integration -- snmp.resolve && npm run test:e2e -- agent-devices-snmp` → green.
- [ ] **Step 2: Typecheck** → PASS.
- [ ] **Step 3: Docs (Rule 10).** API Design Document: the `snmp` field on the agent device-sync; note it's decrypted + TLS-only.
- [ ] **Step 4: Commit** `docs: record Spec 9 resolution + device-sync decryption (Phase C)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** effective-config resolution (device override ?? network) (§6) ✓ Task 2; decrypt only into device-sync (§7, §10) ✓ Tasks 2–3; `SnmpTargetDto` on `AgentDeviceDto` (§7) ✓ Task 1; omit when no credential (§6) ✓ Tasks 2–3; foreign agent never receives it (Spec 8 scope + per-agent token) ✓ Task 3.
- **Deferred (correctly NOT here):** the agent `snmpCollector` consuming `snmp` + the config UI (Phase D); per-device batch optimization of resolution (per-device queries in v1 — a batching refinement noted).
- **Placeholder scan:** none — concrete code/commands.
- **Type consistency:** `SnmpTargetDto`/`AgentDeviceDto.snmp` (shared) ↔ `resolveTarget`/`attachTargets` ↔ the Spec 8 devices endpoint ↔ Phase D's collector; `deviceWithSnmp`/`findCredential`/`findProfile` (Phase A) + `CryptoService.decrypt` (Phase A); credential `snmpVersion` → DTO `version`.
- **Test-config compliance:** resolution integration (real `CryptoService` + test DB); device-sync e2e (Spec 8 enroll + `x-agent-token`). `SECRET_ENCRYPTION_KEY` set in the test env.
- **Integration points to verify during execution:** `AgentModule`↔`SnmpModule` import (no cycle); the Spec 8 `AgentIngestController` constructor gains `SnmpService`; resolution N-queries acceptable at current device counts (batch later if hot).
