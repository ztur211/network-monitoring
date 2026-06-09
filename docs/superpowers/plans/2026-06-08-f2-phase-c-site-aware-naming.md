# F2 Phase C — Site-Aware Device Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an org-configurable, tokenized device-name **suggestion** — `namingTemplate` like `"{site}-{role}-{seq}"` resolved from a device's site path, role, and a collision-free sequence — exposed via a non-binding endpoint. It never bypasses F1a's validation (`namingPattern`/`namingMaxLen`/uniqueness still govern the final name).

**Architecture:** Pure helpers do the token substitution (`naming-tokens.ts`) and category→role mapping (`role-code.ts`); a `NameSuggestionService` (in `DevicesModule`) orchestrates the data it needs — the org template, the property's ancestor chain (codes by type), and a uniqueness check for `{seq}`. The result is purely additive — a new `GET /v1/devices/name-suggestion` endpoint.

**Tech Stack:** NestJS, Prisma 5, Jest. Pure-function helpers, TDD.

**Depends on:** F2 **Phase A** (`PropertiesRepository`) and **Phase B** (`Device.propertyId`/`roleCode`, `DevicesRepository.existsByNameCaseInsensitive` from F1a Phase B). Spec: `2026-06-08-f2-sites-node-grouping-design.md` (§7, §10).

---

## File Structure

**Create:**
- `apps/api/src/devices/role-code.ts` — `roleCodeOf(category)`
- `apps/api/src/devices/naming-tokens.ts` — `renderTemplate`, `fillSeq`, `hasSeqToken`
- `apps/api/src/devices/name-suggestion.service.ts`
- `apps/api/src/devices/__tests__/role-code.spec.ts`
- `apps/api/src/devices/__tests__/naming-tokens.spec.ts`
- `apps/api/src/devices/__tests__/name-suggestion.service.spec.ts`

**Modify:**
- `apps/api/prisma/schema.prisma` — `Organization.namingTemplate String?`
- `apps/api/src/organizations/organizations.dto.ts` — add `namingTemplate` to `ORG_WRITABLE_FIELDS`
- `apps/api/src/organizations/organizations.service.ts` — `toDto` includes `namingTemplate`
- `apps/api/src/properties/properties.repository.ts` — `getAncestorChain`
- `apps/api/src/devices/devices.controller.ts` — `GET /v1/devices/name-suggestion`
- `apps/api/src/devices/devices.module.ts` — register `NameSuggestionService`
- `packages/shared/src/types/api.types.ts` — `OrganizationDto.namingTemplate`, `NameSuggestionDto`

---

## Task 1: Schema + org writable field + shared DTOs

**Files:** Modify `schema.prisma`, `organizations.dto.ts`, `organizations.service.ts`, `packages/shared/src/types/api.types.ts`.

- [ ] **Step 1:** Add `namingTemplate String?` to `model Organization`. Migrate: `cd apps/api && npx prisma migrate dev --name f2_org_naming_template`.

- [ ] **Step 2:** In `api.types.ts`, add `namingTemplate: string | null;` to `OrganizationDto`, and:

```typescript
export interface NameSuggestionDto { suggestedName: string | null; }
```

- [ ] **Step 3:** In `organizations.dto.ts`, extend `ORG_WRITABLE_FIELDS` to include `'namingTemplate'`. In `organizations.service.ts`, add `namingTemplate: o.namingTemplate` to the object returned by `toDto`.

- [ ] **Step 4: Build shared.** `cd packages/shared && npm run build` → PASS. `cd apps/api && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit** `feat(api): add Organization.namingTemplate (writable) + NameSuggestionDto`.

---

## Task 2: `roleCodeOf` (pure helper, TDD)

**Files:** Create `role-code.ts`; test `__tests__/role-code.spec.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
import { roleCodeOf } from '../role-code';

describe('roleCodeOf', () => {
  it('maps known categories to short codes', () => {
    expect(roleCodeOf('ROUTER')).toBe('rtr');
    expect(roleCodeOf('SWITCH')).toBe('sw');
  });
  it('falls back to a lowercased category for unmapped values', () => {
    expect(roleCodeOf('SOMETHING_NEW' as any)).toBe('something_new');
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:unit -- role-code`.

- [ ] **Step 3: Implement `role-code.ts`** — fill `ROLE_CODES` with an entry for **every** `DeviceCategory` enum member (open `@prisma/client`'s `DeviceCategory` and cover all; the map below is illustrative):

```typescript
import { DeviceCategory } from '@prisma/client';

const ROLE_CODES: Partial<Record<DeviceCategory, string>> = {
  ROUTER: 'rtr',
  SWITCH: 'sw',
  // ... add a code for EVERY DeviceCategory member ...
};

export function roleCodeOf(category: DeviceCategory): string {
  return ROLE_CODES[category] ?? String(category).toLowerCase();
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): add roleCodeOf category→role map`.

---

## Task 3: `naming-tokens` (pure helper, TDD)

**Files:** Create `naming-tokens.ts`; test `__tests__/naming-tokens.spec.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
import { renderTemplate, fillSeq, hasSeqToken } from '../naming-tokens';

describe('naming-tokens', () => {
  const tokens = { site: 'hq', building: 'a', floor: '3', area: '', role: 'rtr' };

  it('substitutes location + role tokens and keeps {seq}', () => {
    expect(renderTemplate('{site}-{role}-{seq}', tokens)).toBe('hq-rtr-{seq}');
  });
  it('collapses separators around empty tokens', () => {
    expect(renderTemplate('{site}-{area}-{role}', tokens)).toBe('hq-rtr');
  });
  it('fills the seq placeholder', () => {
    expect(fillSeq('hq-rtr-{seq}', '01')).toBe('hq-rtr-01');
    expect(hasSeqToken('hq-rtr-{seq}')).toBe(true);
    expect(hasSeqToken('hq-rtr')).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:unit -- naming-tokens`.

- [ ] **Step 3: Implement `naming-tokens.ts`**

```typescript
export interface LocationTokens { site: string; building: string; floor: string; area: string; role: string; }

const SEQ = '{seq}';

/** Substitute every token except {seq}; collapse separator runs left by empty tokens; trim edges. */
export function renderTemplate(template: string, tokens: LocationTokens): string {
  let out = template
    .replace(/\{site\}/g, tokens.site)
    .replace(/\{building\}/g, tokens.building)
    .replace(/\{floor\}/g, tokens.floor)
    .replace(/\{area\}/g, tokens.area)
    .replace(/\{role\}/g, tokens.role);
  // Protect {seq} from separator-collapsing.
  const guarded = out.split(SEQ);
  const cleaned = guarded.map((seg) => seg.replace(/[-_]{2,}/g, (m) => m[0]));
  out = cleaned.join(SEQ).replace(/^[-_]+/, '').replace(/[-_]+$/, '').replace(/[-_]+(\{seq\})/g, '$1').replace(/(\{seq\})[-_]+$/g, '$1');
  return out;
}

export function hasSeqToken(rendered: string): boolean { return rendered.includes(SEQ); }
export function fillSeq(rendered: string, seq: string): string { return rendered.replace(SEQ, seq); }
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): add naming-token renderer`.

---

## Task 4: `PropertiesRepository.getAncestorChain` + `NameSuggestionService` (unit TDD)

**Files:** Modify `properties.repository.ts`; create `name-suggestion.service.ts`; test.

- [ ] **Step 1: Add `getAncestorChain` to `PropertiesRepository`** (self → root, with `type` + `code`)

```typescript
async getAncestorChain(organizationId: string, id: string): Promise<{ type: PropertyType; code: string | null }[]> {
  const rows = await this.prisma.$queryRaw<{ type: PropertyType; code: string | null; depth: number }[]>`
    WITH RECURSIVE chain AS (
      SELECT id, "parentId", type, code, 0 AS depth FROM "Property" WHERE id = ${id} AND "organizationId" = ${organizationId}
      UNION ALL
      SELECT p.id, p."parentId", p.type, p.code, c.depth + 1 FROM "Property" p JOIN chain c ON p.id = c."parentId"
    )
    SELECT type, code, depth FROM chain ORDER BY depth ASC;`;
  return rows.map((r) => ({ type: r.type, code: r.code }));
}
```

- [ ] **Step 2: Write the failing service test**

```typescript
import { Test } from '@nestjs/testing';
import { NameSuggestionService } from '../name-suggestion.service';
import { OrganizationsRepository } from '../../organizations/organizations.repository';
import { PropertiesRepository } from '../../properties/properties.repository';
import { DevicesRepository } from '../devices.repository';

const orgsMock = () => ({ findOrganizationById: jest.fn() });
const propsMock = () => ({ getAncestorChain: jest.fn() });
const devicesMock = () => ({ existsByNameCaseInsensitive: jest.fn() });

describe('NameSuggestionService', () => {
  let svc: NameSuggestionService; let orgs: any; let props: any; let devices: any;
  beforeEach(async () => {
    orgs = orgsMock(); props = propsMock(); devices = devicesMock();
    const m = await Test.createTestingModule({ providers: [
      NameSuggestionService,
      { provide: OrganizationsRepository, useValue: orgs },
      { provide: PropertiesRepository, useValue: props },
      { provide: DevicesRepository, useValue: devices },
    ] }).compile();
    svc = m.get(NameSuggestionService);
  });

  it('returns null when the org has no template', async () => {
    orgs.findOrganizationById.mockResolvedValue({ namingTemplate: null });
    expect(await svc.suggest('o1', 'p1', 'ROUTER', null)).toBeNull();
  });

  it('resolves tokens and the lowest free {seq}', async () => {
    orgs.findOrganizationById.mockResolvedValue({ namingTemplate: '{site}-{role}-{seq}' });
    props.getAncestorChain.mockResolvedValue([{ type: 'FLOOR', code: '3' }, { type: 'BUILDING', code: 'a' }, { type: 'SITE', code: 'hq' }]);
    devices.existsByNameCaseInsensitive.mockResolvedValueOnce(true).mockResolvedValueOnce(false); // hq-rtr-01 taken, 02 free
    expect(await svc.suggest('o1', 'p1', 'ROUTER', null)).toBe('hq-rtr-02');
  });
});
```

- [ ] **Step 3: Run → FAIL.** `cd apps/api && npm run test:unit -- name-suggestion.service`.

- [ ] **Step 4: Implement `name-suggestion.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { DeviceCategory, PropertyType } from '@prisma/client';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { PropertiesRepository } from '../properties/properties.repository';
import { DevicesRepository } from './devices.repository';
import { roleCodeOf } from './role-code';
import { renderTemplate, fillSeq, hasSeqToken, LocationTokens } from './naming-tokens';

const SEQ_PAD = 2;
const SEQ_MAX = 9999;

@Injectable()
export class NameSuggestionService {
  constructor(
    private readonly orgs: OrganizationsRepository,
    private readonly props: PropertiesRepository,
    private readonly devices: DevicesRepository,
  ) {}

  async suggest(organizationId: string, propertyId: string, category: DeviceCategory, roleCode: string | null): Promise<string | null> {
    const org = await this.orgs.findOrganizationById(organizationId);
    if (!org?.namingTemplate) return null;

    const chain = await this.props.getAncestorChain(organizationId, propertyId); // self → root
    const codeOf = (t: PropertyType) => chain.find((c) => c.type === t)?.code ?? '';
    const tokens: LocationTokens = {
      site: codeOf('SITE'), building: codeOf('BUILDING'), floor: codeOf('FLOOR'), area: codeOf('AREA'),
      role: roleCode ?? roleCodeOf(category),
    };

    const rendered = renderTemplate(org.namingTemplate, tokens);
    if (!hasSeqToken(rendered)) return rendered.length > 0 ? rendered : null;

    for (let n = 1; n <= SEQ_MAX; n++) {
      const candidate = fillSeq(rendered, String(n).padStart(SEQ_PAD, '0'));
      if (!(await this.devices.existsByNameCaseInsensitive(organizationId, candidate))) return candidate;
    }
    return null;
  }
}
```

- [ ] **Step 5: Run → PASS.** Commit `feat(api): NameSuggestionService (template + tokens + collision-free seq)`.

---

## Task 5: Endpoint + module wiring (e2e)

**Files:** Modify `devices.controller.ts`, `devices.module.ts`; test.

- [ ] **Step 1: Add the endpoint** to `DevicesController` (read-only — any member may fetch a suggestion):

```typescript
import { Query } from '@nestjs/common';
import { DeviceCategory } from '@prisma/client';
// ...
@Get('name-suggestion')
async nameSuggestion(
  @OrgId() orgId: string,
  @Query('propertyId', ParseUUIDPipe) propertyId: string,
  @Query('category') category: DeviceCategory,
  @Query('roleCode') roleCode?: string,
) {
  const suggestedName = await this.nameSuggestion.suggest(orgId, propertyId, category, roleCode ?? null);
  return { success: true, data: { suggestedName }, timestamp: new Date().toISOString() };
}
```

> Declare this route **before** any `@Get(':id')` in the controller so `name-suggestion` isn't captured as an `:id` param. Inject `NameSuggestionService` as `nameSuggestion` in the constructor. The `networkId` query param from the spec is accepted but unused by resolution (kept for forward-compat); omit it if your validation pipe rejects unknown query params.

- [ ] **Step 2: Register `NameSuggestionService`** in `devices.module.ts` providers. `DevicesModule` already imports `PropertiesModule` (Phase B) and `OrganizationsModule` (F1a); confirm both export the repositories injected (`PropertiesRepository`, `OrganizationsRepository`).

- [ ] **Step 3: Write the e2e** — set an org `namingTemplate` (`PATCH /v1/organizations/me` as OWNER), create a SITE with `code`, then `GET /v1/devices/name-suggestion?propertyId=…&category=ROUTER` returns a resolved name; with no template set it returns `{ suggestedName: null }`.

- [ ] **Step 4: Run → PASS.** Commit `feat(api): GET /v1/devices/name-suggestion endpoint`.

---

## Task 6: Full suite + docs

- [ ] **Step 1: Full suite.** `cd apps/api && npm run test:unit && npm run test:integration && npm run test:e2e` → all green.
- [ ] **Step 2: Docs (Rule 10).** Document `namingTemplate`, the token grammar (`{site}/{building}/{floor}/{area}/{role}/{seq}`), and the `name-suggestion` endpoint in the API Design Document; note that the template is a non-binding suggestion layered on F1a's `namingPattern` validator.
- [ ] **Step 3: Commit** `docs: document site-aware naming; test: full suite green`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** `namingTemplate` field + org-writable (§7) ✓ Task 1; token grammar incl. `{role} = roleCode ?? roleCodeOf(category)` (§7) ✓ Tasks 2-4; collision-free `{seq}` (§7) ✓ Task 4; empty-token separator collapse + unresolvable → `null` (§7) ✓ Tasks 3-4; non-binding suggestion endpoint, validation unchanged (§7) ✓ Task 5; `OrganizationDto.namingTemplate` + `NameSuggestionDto` (§10.1) ✓ Task 1; endpoint (§10.5) ✓ Task 5.
- **Type consistency:** `roleCodeOf(category)`, `renderTemplate(template, tokens)`, `fillSeq`/`hasSeqToken`, `getAncestorChain(orgId, id) → {type, code}[]`, `existsByNameCaseInsensitive(orgId, name)` (F1a Phase B), `suggest(orgId, propertyId, category, roleCode|null)` align across helper/service/controller/tests.
- **Routing:** `name-suggestion` GET registered before `:id` to avoid param capture (Task 5 note).
- **Integration points to verify during execution:** the full `DeviceCategory` enum (Task 2 map must cover all members), the `ORG_WRITABLE_FIELDS`/`toDto` location (Task 1), and that `PropertiesModule`/`OrganizationsModule` export the injected repositories (Task 5).
