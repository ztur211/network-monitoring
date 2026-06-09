# F1a Phase D — Realtime Org Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make live sync org-wide — every socket joins its organization's room on connect, and entity mutation events broadcast to that org room so teammates see each other's changes in real time. Per-user AI conversation channels are untouched.

**Architecture:** `RealtimeGateway.handleConnection` already joins `user:${userId}` and `tier:${tier}`; add an `org:${orgId}` join by resolving the connecting user's membership. `ConflictResolutionService.emitEntityEvent` currently routes entity events to a single user (`pushToUser`); switch it to the org room (`pushToOrg`, which already exists on the gateway), and update entity-service call sites to pass `organizationId`. This is the final piece that completes multi-user collaboration.

**Tech Stack:** NestJS, Socket.io, Jest. No new dependencies.

**Depends on:** Phase A (`OrganizationsRepository`, `org:{orgId}` room convention) and Phase B (entity services have `organizationId` in hand at emit time, and currently pass the creator `userId` to `emitEntityEvent` as a placeholder to be switched here).

---

## File Structure

**Modify:**
- `apps/api/src/realtime/realtime.gateway.ts` — join `org:${orgId}` on connect
- `apps/api/src/realtime/realtime.module.ts` — import `OrganizationsModule` (for `OrganizationsRepository`)
- `apps/api/src/conflict/conflict-resolution.service.ts` — `emitEntityEvent` routes to the org room
- each entity service (`devices`, `networks`, `connections`, `fiber-runs`, `circuits`) — pass `organizationId` (not the creator `userId`) to `emitEntityEvent`
- tests for the gateway and conflict service

---

## Task 1: Join the org room on socket connect

**Files:**
- Modify: `apps/api/src/realtime/realtime.gateway.ts`
- Modify: `apps/api/src/realtime/realtime.module.ts`
- Test: `apps/api/src/realtime/__tests__/realtime.gateway.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('joins the org room for a member on connect', async () => {
  const repo = { findMemberByUserId: jest.fn().mockResolvedValue({ organizationId: 'org1', role: 'MEMBER' }) };
  const gateway = new RealtimeGateway(/* existing deps */, repo as any);
  const joined: string[] = [];
  const client: any = {
    handshake: { headers: {} },
    data: {},
    join: (room: string) => { joined.push(room); },
    disconnect: jest.fn(),
  };
  // Stub auth.api.getSession to return a session for user 'u1' (mirror the existing gateway test's session stub).
  await gateway.handleConnection(client);
  expect(client.data.orgId).toBe('org1');
  expect(joined).toContain('org:org1');
});
```

Mirror the existing gateway spec's mechanism for stubbing `auth.api.getSession` (the gateway resolves the session from `client.handshake.headers`). If no gateway spec exists yet, create this file and stub `getSession` to return `{ user: { id: 'u1', tier: 'PERSONAL_FREE' }, session: {} }`.

- [ ] **Step 2: Run to verify it fails.** `cd apps/api && npm run test:unit -- realtime.gateway` → FAIL.

- [ ] **Step 3: Inject the repository and join the org room**

Add `OrganizationsRepository` to the gateway constructor. In `handleConnection`, after the existing `user:`/`tier:` joins:

```typescript
const member = await this.organizationsRepository.findMemberByUserId(userId);
if (member) {
  client.data.orgId = member.organizationId;
  await client.join(`org:${member.organizationId}`);
}
```

In `realtime.module.ts`, add `OrganizationsModule` to `imports` (it exports `OrganizationsRepository` from Phase A).

- [ ] **Step 4: Run to verify it passes.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): join org room on socket connect`.

---

## Task 2: Route entity events to the org room

**Files:**
- Modify: `apps/api/src/conflict/conflict-resolution.service.ts`
- Modify: `apps/api/src/devices/devices.service.ts`, `networks/*.service.ts`, `connections/*.service.ts`, `fiber-runs/*.service.ts`, `circuits/*.service.ts`
- Test: `apps/api/src/conflict/__tests__/conflict-resolution.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('emits entity events to the org room, not a user room', () => {
  const gateway = { pushToOrg: jest.fn(), pushToUser: jest.fn() };
  const service = new ConflictResolutionService(/* existing deps */, gateway as any);
  service.emitEntityEvent('v1:device:updated', { deviceId: 'd1' }, 'org1');
  expect(gateway.pushToOrg).toHaveBeenCalledWith('org1', 'v1:device:updated', { deviceId: 'd1' });
  expect(gateway.pushToUser).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails.** `cd apps/api && npm run test:unit -- conflict-resolution` → FAIL (still calls `pushToUser`).

- [ ] **Step 3: Switch `emitEntityEvent` to the org room**

Change the method so its third parameter is `organizationId` and it calls `pushToOrg`:

```typescript
emitEntityEvent(event: string, payload: unknown, organizationId: string): void {
  this.realtimeGateway.pushToOrg(organizationId, event, payload);
}
```

- [ ] **Step 4: Update entity-service call sites**

In each service, change every `emitEntityEvent(WS_EVENTS.X, payload, <userId>)` to pass `organizationId` (the scoping arg the method already receives). For example in `DevicesService.updateDevice`:

```typescript
this.conflictService.emitEntityEvent(WS_EVENTS.DEVICE_UPDATED, { deviceId, changes: patch.changes }, organizationId);
```

Do the same in `deleteDevice` and in the create path if it emits, and across `networks`, `connections`, `fiber-runs`, `circuits`.

- [ ] **Step 5: Run to verify it passes.** `cd apps/api && npm run test:unit -- conflict-resolution && npm run test:unit -- devices networks connections fiber-runs circuits` → PASS.

- [ ] **Step 6: Commit** `feat(api): broadcast entity events to the org room`.

---

## Task 3: Cross-org isolation test

**Files:**
- Test: `apps/api/src/realtime/__tests__/realtime.org-isolation.e2e-spec.ts`

- [ ] **Step 1: Write the test** — two socket clients authenticated as members of different orgs; emitting a device event for org A reaches client A but not client B.

Mirror the repo's existing realtime e2e harness (how it boots the gateway and connects socket.io-client test clients). Concretely:
- Seed org A + member userA, org B + member userB.
- Connect clientA (as userA) and clientB (as userB); both await their `org:` join.
- Trigger `pushToOrg('orgA', WS_EVENTS.DEVICE_UPDATED, {...})` (directly via the gateway, or by performing a device update as userA).
- Assert clientA receives the event within a timeout and clientB does not.

If the repo has no socket.io e2e harness to mirror, implement this as a focused integration test on `RealtimeGateway` that asserts `server.to('org:orgA').emit(...)` is invoked (spying on the Socket.io server's `to`) rather than spinning up real clients.

- [ ] **Step 2: Run it.** `cd apps/api && npm run test:e2e -- realtime.org-isolation` (or `test:integration` if implemented as integration) → PASS.

- [ ] **Step 3: Commit** `test(api): verify entity events are isolated per org room`.

---

## Task 4: Full suite + docs

- [ ] **Step 1: Run the full backend suite.** `cd apps/api && npm run test:unit && npm run test:integration && npm run test:e2e` → all green.
- [ ] **Step 2: Docs (Rule 10).** Update the SAD realtime/multi-tenancy section and CLAUDE.md to state that entity events broadcast to `org:{organizationId}` rooms (AI conversations remain per-user). Confirm the org WS events from Phase A (`v1:org:*`) are documented in the API Design Document.
- [ ] **Step 3: Commit** `docs: document org-room realtime broadcasting`.

---

## F1a is complete after this phase

With Phases A–D done, F1a is fully implemented: org tenancy + provisioning (A), all data org-scoped with naming policy (B), full audit trail (C), and live org-wide sync (D). Next on the roadmap: **F1b** (invitations & request-to-join), and in parallel the **F2 → F3** permissions track and the **Spec 1 → 2 → 3** spatial/3D track.

Run the **superpowers:finishing-a-development-branch** skill to wrap up the `feat/f1a-...` branch(es) once all four phases are merged and green.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** realtime events move to org-level rooms (§8) ✓ Tasks 1–2; AI conversations stay per-user ✓ (no change made to AI channels); cross-org isolation ✓ Task 3.
- **Type consistency:** `emitEntityEvent(event, payload, organizationId)` — the renamed third param is passed `organizationId` at every call site (Task 2 Step 4); `pushToOrg(orgId, event, payload)` matches the gateway method confirmed to exist. `findMemberByUserId` returns `{ organizationId, role }` as in Phase A.
- **Integration points to verify during execution:** the existing gateway spec's `auth.api.getSession` stubbing approach (Task 1 Step 1); the exact constructor parameter order when adding `OrganizationsRepository` to the gateway and `RealtimeGateway` to `ConflictResolutionService` (don't reorder existing deps — append); whether a socket.io e2e harness already exists (Task 3).
