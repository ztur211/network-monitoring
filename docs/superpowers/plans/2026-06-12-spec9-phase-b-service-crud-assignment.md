# Spec 9 Phase B — SNMP Service, CRUD & Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage SNMP credentials + OID profiles and assign them — `SnmpService` (encrypt secrets on create, **omit them on read**, block delete-while-assigned → `SNMP_003`), the `/v1/snmp/*` endpoints (OWNER/ADMIN), and an F3-scoped assignment endpoint that sets the credential/profile on a network or device.

**Architecture:** `SnmpService` wraps `SnmpRepository` + `CryptoService`: create encrypts `community`/`authKey`/`privKey` into the `*Enc` blobs; read DTOs expose only `has*` booleans; delete checks assignment counts. `SnmpController` exposes CRUD; assignment validates the credential/profile belong to the org and runs F3's `assertCanConfigure` on the target.

**Tech Stack:** NestJS 11, Prisma, Jest (integration + e2e).

**Depends on:**
- **Phase A** — `CryptoService`, `SnmpRepository`.
- **F1a/F3** — `@OrgRoles('OWNER','ADMIN')`, `@OrgId`, `@CurrentMember`, `NodeScopeException`, `PermissionsService.assertCanConfigure`.
- Spec: `2026-06-12-spec9-agent-snmp-design.md` (§6, §9).

> Resolution + device-sync decryption (Phase C); agent collector + UI (Phase D).

---

## File Structure

**Create:**
- `apps/api/src/snmp/snmp.service.ts`, `snmp.controller.ts`, `snmp.module.ts`
- `packages/shared/src/types/snmp.types.ts` — SNMP DTOs
- tests `apps/api/src/snmp/__tests__/{snmp.controller.e2e.ts, snmp.assignment.e2e.ts}`

---

## Task 1: Shared DTOs + error codes

- [ ] **Step 1: `snmp.types.ts`:**
```typescript
export type SnmpVersion = 'V2C' | 'V3';
export interface SnmpCredentialDto {
  id: string; name: string; snmpVersion: SnmpVersion;
  securityLevel: string | null; securityName: string | null; authProtocol: string | null; privProtocol: string | null;
  hasCommunity: boolean; hasAuthKey: boolean; hasPrivKey: boolean;   // never the secrets themselves
}
export interface CreateSnmpCredentialDto {
  name: string; snmpVersion: SnmpVersion; securityLevel?: string; securityName?: string;
  authProtocol?: string; privProtocol?: string; community?: string; authKey?: string; privKey?: string;
}
export interface OidEntryDto { oid: string; metric: string }
export interface OidProfileDto { id: string; name: string; includeInterfaceMetrics: boolean; entries: OidEntryDto[] }
export interface CreateOidProfileDto { name: string; includeInterfaceMetrics: boolean; entries: OidEntryDto[] }
export interface AssignSnmpDto { targetType: 'network' | 'device'; targetId: string; snmpCredentialId: string | null; oidProfileId: string | null }
```
`cd packages/shared && npm run build`. Register `SNMP_001 CREDENTIAL_NOT_FOUND` (404), `SNMP_002 OID_PROFILE_NOT_FOUND` (404), `SNMP_003 SNMP_RESOURCE_ASSIGNED` (409) in the error registry.

---

## Task 2: `SnmpService` credentials + profiles (Jest integration)

**Files:** Create `snmp.service.ts`; test `snmp/__tests__/snmp.service.spec.ts`.

- [ ] **Step 1: Failing test** — create encrypts, read omits secrets, delete-while-assigned blocks:
```typescript
it('encrypts on create, omits secrets on read, blocks delete while assigned', async () => {
  const dto = await svc.createCredential(orgId, { name: 'v2c', snmpVersion: 'V2C', community: 'public' });
  expect(dto.hasCommunity).toBe(true); expect((dto as any).community).toBeUndefined();
  const row = await repo.findCredential(orgId, dto.id);
  expect(row!.communityEnc).not.toBe('public');             // stored encrypted
  expect(crypto.decrypt(row!.communityEnc!)).toBe('public'); // and recoverable
  await prisma.network.create({ data: { organizationId: orgId, name: 'N', snmpCredentialId: dto.id } });
  await expect(svc.deleteCredential(orgId, dto.id)).rejects.toMatchObject({ code: 'SNMP_003' });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `snmp.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { SnmpCredentialDto, CreateSnmpCredentialDto, OidProfileDto, CreateOidProfileDto } from '@nodescope/shared';
import { SnmpCredential, OidProfile } from '@prisma/client';
import { SnmpRepository } from './snmp.repository';
import { CryptoService } from '../common/crypto/crypto.service';
import { NodeScopeException } from '../common/errors/nodescope.exception';

@Injectable()
export class SnmpService {
  constructor(private readonly repo: SnmpRepository, private readonly crypto: CryptoService) {}

  private toCredDto(c: SnmpCredential): SnmpCredentialDto {
    return { id: c.id, name: c.name, snmpVersion: c.snmpVersion, securityLevel: c.securityLevel, securityName: c.securityName,
      authProtocol: c.authProtocol, privProtocol: c.privProtocol, hasCommunity: !!c.communityEnc, hasAuthKey: !!c.authKeyEnc, hasPrivKey: !!c.privKeyEnc };
  }
  private enc(v?: string) { return v ? this.crypto.encrypt(v) : null; }

  async createCredential(orgId: string, d: CreateSnmpCredentialDto): Promise<SnmpCredentialDto> {
    const c = await this.repo.createCredential({ organizationId: orgId, name: d.name, snmpVersion: d.snmpVersion,
      securityLevel: (d.securityLevel as any) ?? null, securityName: d.securityName ?? null,
      authProtocol: (d.authProtocol as any) ?? null, privProtocol: (d.privProtocol as any) ?? null,
      communityEnc: this.enc(d.community), authKeyEnc: this.enc(d.authKey), privKeyEnc: this.enc(d.privKey) });
    return this.toCredDto(c);
  }
  async listCredentials(orgId: string): Promise<SnmpCredentialDto[]> { return (await this.repo.listCredentials(orgId)).map((c) => this.toCredDto(c)); }
  async deleteCredential(orgId: string, id: string): Promise<void> {
    if (!(await this.repo.findCredential(orgId, id))) throw new NodeScopeException('SNMP_001', 'Credential not found', 404);
    if (await this.repo.countCredentialAssignments(id) > 0) throw new NodeScopeException('SNMP_003', 'Credential is assigned', 409);
    await this.repo.deleteCredential(id);
  }

  async createProfile(orgId: string, d: CreateOidProfileDto): Promise<OidProfileDto> {
    const p = await this.repo.createProfile({ organizationId: orgId, name: d.name, includeInterfaceMetrics: d.includeInterfaceMetrics }, d.entries);
    return (await this.profileDto(orgId, p.id))!;
  }
  async listProfiles(orgId: string): Promise<OidProfile[]> { return this.repo.listProfiles(orgId); }
  async profileDto(orgId: string, id: string): Promise<OidProfileDto | null> {
    const p = await this.repo.findProfile(orgId, id);
    return p ? { id: p.id, name: p.name, includeInterfaceMetrics: p.includeInterfaceMetrics, entries: p.entries.map((e) => ({ oid: e.oid, metric: e.metric })) } : null;
  }
  async deleteProfile(orgId: string, id: string): Promise<void> {
    if (!(await this.repo.findProfile(orgId, id))) throw new NodeScopeException('SNMP_002', 'OID profile not found', 404);
    if (await this.repo.countProfileAssignments(id) > 0) throw new NodeScopeException('SNMP_003', 'OID profile is assigned', 409);
    await this.repo.deleteProfile(id);
  }
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(api): SnmpService (encrypt-on-create, secrets-omitted reads, SNMP_003)`.

---

## Task 3: Assignment (Jest e2e)

**Files:** Add `assign` to `snmp.service.ts`; the controller route; test `snmp/__tests__/snmp.assignment.e2e.ts`.

- [ ] **Step 1: Failing e2e** — assign a credential to a network (in scope); reject out of scope:
```typescript
it('assigns a credential to a network', async () => {
  const { id: credId } = (await request(srv).post('/v1/snmp/credentials').set(ownerAuth).send({ name: 'c', snmpVersion: 'V2C', community: 'public' }).expect(201)).body.data;
  await request(srv).post('/v1/snmp/assign').set(ownerAuth).send({ targetType: 'network', targetId: networkId, snmpCredentialId: credId, oidProfileId: null }).expect(200);
  expect((await prisma.network.findUnique({ where: { id: networkId } }))!.snmpCredentialId).toBe(credId);
});
```

- [ ] **Step 2: Run → FAIL**, then add `assign` (validate org + F3 scope on the target):
```typescript
// SnmpService — inject PermissionsService + PrismaService
async assign(orgId: string, member: Member, d: AssignSnmpDto): Promise<void> {
  if (d.snmpCredentialId && !(await this.repo.findCredential(orgId, d.snmpCredentialId))) throw new NodeScopeException('SNMP_001', 'Credential not found', 404);
  if (d.oidProfileId && !(await this.repo.findProfile(orgId, d.oidProfileId))) throw new NodeScopeException('SNMP_002', 'OID profile not found', 404);
  const entity = d.targetType === 'device' ? { type: 'Device', id: d.targetId } : { type: 'Network', id: d.targetId };
  await this.permissions.assertCanConfigure(member, entity);     // F3 → PERM_001/404 if out of scope
  const data = { snmpCredentialId: d.snmpCredentialId, oidProfileId: d.oidProfileId };
  if (d.targetType === 'device') await this.prisma.device.update({ where: { id: d.targetId }, data });
  else await this.prisma.network.update({ where: { id: d.targetId }, data });
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(api): SNMP assignment (network/device, F3-scoped)`.

---

## Task 4: `SnmpController` + module (Jest e2e)

**Files:** Create `snmp.controller.ts`, `snmp.module.ts`; test `snmp/__tests__/snmp.controller.e2e.ts`.

- [ ] **Step 1: Failing e2e** — CRUD + OWNER/ADMIN gate + reads omit secrets:
```typescript
it('credential CRUD; list never returns secrets; MEMBER blocked', async () => {
  await request(srv).post('/v1/snmp/credentials').set(memberAuth).send({ name: 'x', snmpVersion: 'V2C', community: 'public' }).expect(403);
  const created = (await request(srv).post('/v1/snmp/credentials').set(ownerAuth).send({ name: 'c', snmpVersion: 'V2C', community: 'public' }).expect(201)).body.data;
  const list = (await request(srv).get('/v1/snmp/credentials').set(ownerAuth).expect(200)).body.data;
  expect(JSON.stringify(list)).not.toContain('public');     // no secret leaks
  expect(list[0].hasCommunity).toBe(true);
  await request(srv).delete(`/v1/snmp/credentials/${created.id}`).set(ownerAuth).expect(200);
});
```

- [ ] **Step 2: Run → FAIL**, then implement `snmp.controller.ts`:
```typescript
@Controller('v1/snmp')
export class SnmpController {
  constructor(private readonly svc: SnmpService) {}
  @Post('credentials') @OrgRoles('OWNER', 'ADMIN')
  createCred(@OrgId() o: string, @Body() b: CreateSnmpCredentialDto) { return this.svc.createCredential(o, b); }
  @Get('credentials') @OrgRoles('OWNER', 'ADMIN')
  listCred(@OrgId() o: string) { return this.svc.listCredentials(o); }
  @Delete('credentials/:id') @OrgRoles('OWNER', 'ADMIN')
  delCred(@OrgId() o: string, @Param('id') id: string) { return this.svc.deleteCredential(o, id); }
  @Post('oid-profiles') @OrgRoles('OWNER', 'ADMIN')
  createProf(@OrgId() o: string, @Body() b: CreateOidProfileDto) { return this.svc.createProfile(o, b); }
  @Get('oid-profiles') @OrgRoles('OWNER', 'ADMIN')
  listProf(@OrgId() o: string) { return this.svc.listProfiles(o); }
  @Delete('oid-profiles/:id') @OrgRoles('OWNER', 'ADMIN')
  delProf(@OrgId() o: string, @Param('id') id: string) { return this.svc.deleteProfile(o, id); }
  @Post('assign') @OrgRoles('OWNER', 'ADMIN')
  assign(@OrgId() o: string, @CurrentMember() m: Member, @Body() b: AssignSnmpDto) { return this.svc.assign(o, m, b); }
}
```
`snmp.module.ts` imports `CryptoModule` + `PermissionsModule`, provides `SnmpService`/`SnmpRepository`, registers `SnmpController`.

- [ ] **Step 3: Run → PASS.** Commit `feat(api): SNMP controller (credentials/profiles/assign)`.

---

## Task 5: Phase gate

- [ ] **Step 1: Suites.** `cd apps/api && npm run test:integration -- snmp && npm run test:e2e -- snmp` → green.
- [ ] **Step 2: Typecheck** → PASS.
- [ ] **Step 3: Docs (Rule 10).** API Design Document: `/v1/snmp/*` + `SNMP_001`–`SNMP_003`; note credential reads never include secrets.
- [ ] **Step 4: Commit** `docs: record Spec 9 SNMP service + CRUD + assignment (Phase B)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** encrypt-on-create + write-only reads (§9, §10) ✓ Task 2; credential + profile CRUD (§9) ✓ Tasks 2, 4; delete-while-assigned → `SNMP_003` (§6) ✓ Task 2; F3-scoped assignment (network/device) (§9) ✓ Task 3; OWNER/ADMIN gate (§9) ✓ Task 4.
- **Deferred (correctly NOT here):** resolution + device-sync decryption (Phase C); agent collector + UI (Phase D).
- **Placeholder scan:** none — concrete code/commands.
- **Type consistency:** `SnmpCredentialDto`/`CreateSnmpCredentialDto`/`OidProfileDto`/`CreateOidProfileDto`/`AssignSnmpDto` (shared) ↔ service ↔ controller; `SnmpService` uses Phase A `CryptoService.encrypt` + `SnmpRepository` (`createCredential`/`findCredential`/`countCredentialAssignments`/`createProfile`/`findProfile`/`countProfileAssignments`); `assertCanConfigure` (F3); `snmpVersion` field name.
- **Test-config compliance:** service integration (test DB + real `CryptoService` with a test key) + e2e (OWNER/MEMBER auth helpers). The e2e asserts secrets never appear in responses.
- **Integration points to verify during execution:** F3 `assertCanConfigure` entity-arg shape; the `@CurrentMember`/`Member` type; that `SECRET_ENCRYPTION_KEY` is set in the test env; the existing error-envelope shape for `SNMP_*`.
