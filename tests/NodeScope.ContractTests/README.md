# NodeScope.ContractTests

The black-box parity suite (migration Decision 4). It talks to a running API over
HTTP at a single `BASE_URL` and references **no** implementation project - so the
same tests point at the NestJS API today and the C# host as modules land, chosen
only by the `NODESCOPE_BASE_URL` environment variable (default
`http://localhost:3000`). Green against Node before the port begins; the permanent
.NET integration suite afterward.

See [`COVERAGE.md`](./COVERAGE.md) for the endpoint/event work-list and status.

## Running it

The suite is only the *client*. Bring up a target first:

```bash
# 1. test stack: throwaway db (5433), redis (6380), minio (9100)
docker compose -f docker-compose.test.yml up -d

# 2. schema + one-time seed into the test DB (see "Seeding" below)
DATABASE_URL=postgresql://nodescope:localdevpassword@localhost:5433/nodescope_test \
  npm run db:migrate
DATABASE_URL=postgresql://nodescope:localdevpassword@localhost:5433/nodescope_test \
  SEED_PASSWORD=devpassword123 BETTER_AUTH_SECRET=test-secret-minimum-32-characters-long-aaa \
  npm run db:seed

# 3. build + run the Node target (env mirrors jest.e2e.setup.ts)
npm run build --workspace=apps/api
scripts/run-contract-target.sh &

# 4. run the suite
dotnet test tests/NodeScope.ContractTests
```

If the target is unreachable the fixture fails once, on start, with a message that
says so - it probes `/api/health` before any test runs.

To point at a different host: `NODESCOPE_BASE_URL=https://... dotnet test ...`.

## Seeding strategy

The suite arranges state **over HTTP wherever the API allows it** - fresh users via
`sign-up`, and isolated per-test orgs via `POST /api/v1/admin/organizations` + owner
designation. That keeps arrange-time bugs in scope and the suite
implementation-agnostic.

Any test needing an isolated org calls `fixture.ProvisionOrgAsync()` and gets a
`ProvisionedOrg` - a fresh organization with a brand-new OWNER
(`org.OwnerCookie` / `org.OwnerBearer`) that works for org-scoped calls immediately.
Under the hood (`Fixtures/OrgProvisioning.cs`) the shared super-admin creates the
org, a new user signs up, and the super-admin designates them owner - exactly the
operator flow. The super-admin is bootstrapped once per run and cached on the
fixture (`SuperAdminAsync`).

There is exactly **one** thing the API cannot do over HTTP, by deliberate design:
grant super-admin. `isSuperAdmin` is `input: false` in `better-auth.config.ts`, so
it is settable only in the database. `Fixtures/SuperAdminGrant.cs` owns that single
non-HTTP step - a lone parameterized `UPDATE "User" SET "isSuperAdmin" = true` - and
signs in *afresh* afterward so the session reflects the promotion (Better Auth's
`cookieCache` otherwise serves the pre-promotion user). It connects with
`NODESCOPE_DATABASE_URL` (a libpq URL or a native Npgsql string; default is the
contract-test DB, `postgresql://nodescope:localdevpassword@localhost:5433/nodescope_test`)
- this **must** name the same database the target under test writes to.

The seed (`apps/api/prisma/seed.ts`) creates:

- `admin@nodescope.test` - super-admin, **no credential** (created via direct
  insert, so it cannot sign in; give it a password out-of-band, or grant
  super-admin to a signed-up user with a single `UPDATE "User" SET
  "isSuperAdmin"=true`, when the admin-org tests are written).
- `owner@acme.test` / `devpassword123` - OWNER of the populated **Acme Networks**
  org (site tree, 1 network, 5 devices, connections, a fiber run, a circuit). Used
  by the current org read tests. Overridable via `NODESCOPE_SEED_OWNER_EMAIL` /
  `NODESCOPE_SEED_OWNER_PASSWORD`.

The one MinIO upload the seed performs (a sample building model) needs the test
MinIO reachable at the seed's `STORAGE_ENDPOINT`; it is non-fatal if absent.

## Layout

```
Fixtures/
  TestConfig.cs          BASE_URL + seed-principal resolution from env
  ApiClient.cs           HTTP verbs + auth application, relative to {BASE_URL}/api/
  ApiResponse.cs         captured status/headers/cookies + parsed JSON, envelope helpers
  Auth.cs                cookie | bearer | header credential descriptor
  AuthWorkflow.cs        sign-up / sign-in helpers -> UserSession (both credential forms)
  OrgProvisioning.cs     super-admin bootstrap + per-test org (-> ProvisionedOrg)
  SuperAdminGrant.cs     the one non-HTTP step: the super-admin DB grant (Npgsql)
  ContractApiFixture.cs  shared client + health gate + run-scoped super-admin (collection "Contract")
Identity/                first module covered (auth, users, organizations, admin-orgs)
```

Responses are asserted as `JsonElement` rather than typed DTOs: `NodeScope.Contracts`
is referenced (Decision 4) but still an empty skeleton, and black-box assertions on
the wire shape are what parity requires. Introduce Contracts DTOs here only once
they stabilize.
