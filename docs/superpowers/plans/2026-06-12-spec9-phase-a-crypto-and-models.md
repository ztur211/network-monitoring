# Spec 9 Phase A — CryptoService, SNMP Models & Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `CryptoService` (AES-256-GCM secret vault), the `SnmpCredential` / `OidProfile` / `OidEntry` models + the `Network`/`Device` assignment FKs, and the `SnmpRepository` (credential + profile CRUD + assignment counts). No endpoints, resolution, agent, or UI yet.

**Architecture:** `CryptoService` (`common/crypto/`) is the single AES-256-GCM encrypt/decrypt seam, keyed from env. A new `snmp` module holds the Prisma models + a repository; secret fields are stored only as `CryptoService` blobs. Assignment FKs on `Network`/`Device` are `onDelete: Restrict` (delete-block, surfaced as `SNMP_003` in Phase B).

**Tech Stack:** NestJS 11, Prisma 5, Node `crypto`, Jest (unit + integration on the `:5433` test DB).

**Depends on:**
- **F1a** — `Organization`, `ChangeLog` (+ CHECK), `PrismaService`, the config pattern.
- **F2** — `Network`, `Device`.
- Spec: `docs/superpowers/specs/2026-06-12-spec9-agent-snmp-design.md` (§5, §6).

> Service/CRUD/assignment (Phase B); device-sync resolution + decryption (Phase C); agent collector + UI (Phase D).

---

## File Structure

**Create:**
- `apps/api/src/common/crypto/crypto.service.ts` (+ `crypto.module.ts`) — encrypt/decrypt
- `apps/api/src/snmp/snmp.repository.ts`
- tests `apps/api/src/common/crypto/__tests__/crypto.service.spec.ts`, `apps/api/src/snmp/__tests__/snmp.repository.spec.ts`

**Modify:**
- `apps/api/prisma/schema.prisma` — SNMP models/enums + `Network`/`Device` FKs
- the migration — tables + `ChangeLog` CHECK (`'SnmpCredential'`, `'OidProfile'`)
- `.env.example` — `SECRET_ENCRYPTION_KEY`

---

## Task 1: `CryptoService` (Jest unit)

**Files:** Create `common/crypto/crypto.service.ts`, `crypto.module.ts`; test `common/crypto/__tests__/crypto.service.spec.ts`.

- [ ] **Step 1: Failing test:**
```typescript
import { CryptoService, CRYPTO_KEY } from '../crypto.service';
import { randomBytes } from 'node:crypto';

const svc = () => new CryptoService(randomBytes(32)); // 32-byte key

describe('CryptoService', () => {
  it('round-trips and uses a random IV (different ciphertext each call)', () => {
    const c = svc();
    const a = c.encrypt('community-string'); const b = c.encrypt('community-string');
    expect(a).not.toBe(b);
    expect(c.decrypt(a)).toBe('community-string');
  });
  it('rejects a tampered blob (GCM auth)', () => {
    const c = svc(); const blob = Buffer.from(c.encrypt('x'), 'base64'); blob[blob.length - 1] ^= 0xff;
    expect(() => c.decrypt(blob.toString('base64'))).toThrow();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:unit -- crypto.service`.

- [ ] **Step 3: Implement `crypto.service.ts`:**
```typescript
import { Injectable, Inject } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const CRYPTO_KEY = Symbol('CRYPTO_KEY');

@Injectable()
export class CryptoService {
  constructor(@Inject(CRYPTO_KEY) private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('SECRET_ENCRYPTION_KEY must be 32 bytes');
  }
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64'); // iv(12)|tag(16)|ct
  }
  decrypt(blob: string): string {
    const b = Buffer.from(blob, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
    decipher.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString('utf8');
  }
}
```
`crypto.module.ts` provides the key from env (`SECRET_ENCRYPTION_KEY`, base64 32 bytes) and exports `CryptoService`:
```typescript
@Module({ providers: [CryptoService, { provide: CRYPTO_KEY, useFactory: () => {
  const k = process.env.SECRET_ENCRYPTION_KEY; if (!k) throw new Error('SECRET_ENCRYPTION_KEY is required for SNMP');
  return Buffer.from(k, 'base64');
} }], exports: [CryptoService] })
export class CryptoModule {}
```

- [ ] **Step 4: Run → PASS.** Add `SECRET_ENCRYPTION_KEY=` (a base64 32-byte sample) to `.env.example` with a note (`openssl rand -base64 32`). Commit `feat(api): CryptoService (AES-256-GCM secret vault)`.

---

## Task 2: SNMP models + migration

**Files:** `apps/api/prisma/schema.prisma`; migration.

- [ ] **Step 1: Enums + models** (spec §6 — note `snmpVersion`, not `version`):
```prisma
enum SnmpVersion { V2C V3 }
enum SnmpSecurityLevel { NO_AUTH_NO_PRIV AUTH_NO_PRIV AUTH_PRIV }
enum SnmpAuthProtocol { MD5 SHA SHA256 }
enum SnmpPrivProtocol { DES AES AES256 }

model SnmpCredential {
  id String @id @default(uuid())
  organizationId String
  name String
  snmpVersion SnmpVersion
  securityLevel SnmpSecurityLevel?
  securityName String?
  authProtocol SnmpAuthProtocol?
  privProtocol SnmpPrivProtocol?
  communityEnc String?  authKeyEnc String?  privKeyEnc String?
  version Int @default(1)
  createdAt DateTime @default(now())  updatedAt DateTime @updatedAt
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  networks Network[]  devices Device[]
  @@index([organizationId])
}
model OidProfile {
  id String @id @default(uuid())
  organizationId String
  name String
  includeInterfaceMetrics Boolean @default(false)
  version Int @default(1)
  createdAt DateTime @default(now())  updatedAt DateTime @updatedAt
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  entries OidEntry[]  networks Network[]  devices Device[]
  @@index([organizationId])
}
model OidEntry {
  id String @id @default(uuid())
  oidProfileId String
  oid String  metric String
  profile OidProfile @relation(fields: [oidProfileId], references: [id], onDelete: Cascade)
  @@unique([oidProfileId, oid])
}
```

- [ ] **Step 2: Assignment FKs** on `Network` and `Device` (additive, `Restrict`):
```prisma
// in model Network AND model Device:
  snmpCredentialId String?
  oidProfileId     String?
  snmpCredential SnmpCredential? @relation(fields: [snmpCredentialId], references: [id], onDelete: Restrict)
  oidProfile     OidProfile?     @relation(fields: [oidProfileId], references: [id], onDelete: Restrict)
```

- [ ] **Step 3: Migrate.** `cd apps/api && npx prisma migrate dev --name spec9_snmp`. Append the `ChangeLog` CHECK extension adding `'SnmpCredential'`,`'OidProfile'` (mirror the current list). `npx prisma migrate reset --force`; `npx tsc --noEmit` → PASS. Commit `feat(api): SNMP credential/OID-profile models + assignment FKs`.

---

## Task 3: `SnmpRepository` (Jest integration)

**Files:** Create `snmp/snmp.repository.ts`; test `snmp/__tests__/snmp.repository.spec.ts`.

- [ ] **Step 1: Failing integration test:**
```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SnmpRepository } from '../snmp.repository';

describe('SnmpRepository (integration)', () => {
  let repo: SnmpRepository; let prisma: PrismaService; let orgId: string;
  beforeAll(async () => { const r = await Test.createTestingModule({ providers: [SnmpRepository, PrismaService] }).compile(); repo = r.get(SnmpRepository); prisma = r.get(PrismaService); await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { orgId = (await prisma.organization.create({ data: { name: `S${Date.now()}` } })).id; });
  afterEach(async () => { await prisma.organization.delete({ where: { id: orgId } }); });

  it('creates a credential (encrypted blobs), a profile with entries, and counts assignments', async () => {
    const cred = await repo.createCredential({ organizationId: orgId, name: 'core-v2c', snmpVersion: 'V2C', securityLevel: null, securityName: null, authProtocol: null, privProtocol: null, communityEnc: 'BLOB', authKeyEnc: null, privKeyEnc: null });
    expect((await repo.findCredential(orgId, cred.id))?.communityEnc).toBe('BLOB');
    const prof = await repo.createProfile({ organizationId: orgId, name: 'std', includeInterfaceMetrics: true }, [{ oid: '1.3.6.1.2.1.1.5.0', metric: 'sysname' }]);
    expect((await repo.findProfile(orgId, prof.id))?.entries).toHaveLength(1);
    const net = await prisma.network.create({ data: { organizationId: orgId, name: 'N', snmpCredentialId: cred.id } });
    expect(await repo.countCredentialAssignments(cred.id)).toBe(1);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:integration -- snmp.repository`.

- [ ] **Step 3: Implement `snmp.repository.ts`:**
```typescript
import { Injectable } from '@nestjs/common';
import { SnmpCredential, OidProfile, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SnmpRepository {
  constructor(private readonly prisma: PrismaService) {}

  createCredential(data: Prisma.SnmpCredentialUncheckedCreateInput): Promise<SnmpCredential> { return this.prisma.snmpCredential.create({ data }); }
  findCredential(organizationId: string, id: string): Promise<SnmpCredential | null> { return this.prisma.snmpCredential.findFirst({ where: { id, organizationId } }); }
  listCredentials(organizationId: string): Promise<SnmpCredential[]> { return this.prisma.snmpCredential.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }); }
  deleteCredential(id: string): Promise<unknown> { return this.prisma.snmpCredential.delete({ where: { id } }); }
  countCredentialAssignments(id: string): Promise<number> {
    return this.prisma.$transaction([this.prisma.network.count({ where: { snmpCredentialId: id } }), this.prisma.device.count({ where: { snmpCredentialId: id } })]).then(([n, d]) => n + d);
  }
  createProfile(data: { organizationId: string; name: string; includeInterfaceMetrics: boolean }, entries: { oid: string; metric: string }[]): Promise<OidProfile> {
    return this.prisma.oidProfile.create({ data: { ...data, entries: { create: entries } } });
  }
  findProfile(organizationId: string, id: string): Promise<(OidProfile & { entries: { oid: string; metric: string }[] }) | null> {
    return this.prisma.oidProfile.findFirst({ where: { id, organizationId }, include: { entries: true } }) as any;
  }
  listProfiles(organizationId: string): Promise<OidProfile[]> { return this.prisma.oidProfile.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }); }
  deleteProfile(id: string): Promise<unknown> { return this.prisma.oidProfile.delete({ where: { id } }); }
  countProfileAssignments(id: string): Promise<number> {
    return this.prisma.$transaction([this.prisma.network.count({ where: { oidProfileId: id } }), this.prisma.device.count({ where: { oidProfileId: id } })]).then(([n, d]) => n + d);
  }
  // resolution loads (Phase C)
  deviceWithSnmp(organizationId: string, deviceId: string) {
    return this.prisma.device.findFirst({ where: { id: deviceId, organizationId }, select: { id: true, snmpCredentialId: true, oidProfileId: true, network: { select: { snmpCredentialId: true, oidProfileId: true } } } });
  }
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): SnmpRepository`.

---

## Task 4: Phase gate

- [ ] **Step 1: Suites.** `cd apps/api && npm run test:unit -- crypto.service && npm run test:integration -- snmp.repository` → green.
- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` → PASS.
- [ ] **Step 3: Docs (Rule 10).** SAD/CLAUDE.md: the `CryptoService` vault (`SECRET_ENCRYPTION_KEY`) + the SNMP models; API Design Document: register the entities.
- [ ] **Step 4: Commit** `docs: record Spec 9 crypto + SNMP models (Phase A)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** `CryptoService` AES-256-GCM (§5) ✓ Task 1; `SnmpCredential`/`OidProfile`/`OidEntry` + enums, encrypted blobs (§6) ✓ Task 2; assignment FKs `onDelete: Restrict` (§6) ✓ Task 2; repo CRUD + assignment counts for the delete-block (§6) ✓ Task 3.
- **Deferred (correctly NOT here):** the service (encrypt-on-create / secrets-omitted reads / `SNMP_003`) + CRUD endpoints + assignment (Phase B); resolution + decryption into device-sync (Phase C); agent `snmpCollector` + UI (Phase D). `deviceWithSnmp` is provided here for Phase C.
- **Placeholder scan:** none — concrete code/commands.
- **Type consistency:** `CryptoService.encrypt/decrypt` (Phase B/C); `CRYPTO_KEY` token; `SnmpRepository` methods (`createCredential`/`findCredential`/`listCredentials`/`deleteCredential`/`countCredentialAssignments`/`createProfile`/`findProfile`/`listProfiles`/`deleteProfile`/`countProfileAssignments`/`deviceWithSnmp`) are Phase B/C's surface; `snmpVersion` field (not `version`) avoids the optimistic-`version` clash.
- **Test-config compliance:** crypto unit (injected key); repo integration (test DB). No secrets logged.
- **Integration points to verify during execution:** the current `ChangeLog` CHECK list to extend; that `CryptoModule` is imported where `CryptoService` is used (Phase B/C); base64 vs hex for `SECRET_ENCRYPTION_KEY` (base64 here); Prisma relation back-references on `Network`/`Device` compile.
