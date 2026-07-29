# NodeScope.ContractTests

The permanent black-box integration suite. It talks to a running appliance over
HTTP and SignalR at a single `BASE_URL` and references **no** implementation
project. The target is chosen only by `NODESCOPE_BASE_URL`, which defaults to
`http://127.0.0.1:5199`.

See [`COVERAGE.md`](./COVERAGE.md) for the endpoint/event work-list and status.

## Running it

The suite is only the *client*. Bring up the target first:

```bash
# 1. Test stack: throwaway database (5433), Redis (6380), and MinIO (9100).
docker compose -f docker-compose.test.yml up -d

# 2. Apply migrations and seed the disposable database.
SEED_PASSWORD=devpassword123 scripts/run-csharp-host.sh seed

# 3. Start the API on :5199.
scripts/run-csharp-host.sh
```

The test host script uses one-second alert evaluation and delivery cycles so
metric-duration and durable-delivery contracts remain deterministic and fast.

In another terminal:

```bash
NODESCOPE_BASE_URL=http://127.0.0.1:5199 \
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
`ProvisionedOrg` - a fresh organization with a brand-new OWNER (`org.OwnerAuth`)
that works for org-scoped calls immediately.
Under the hood (`Fixtures/OrgProvisioning.cs`) the shared super-admin creates the
org, a new user signs up, and the super-admin designates them owner - exactly the
operator flow. The super-admin is bootstrapped once per run and cached on the
fixture (`SuperAdminAsync`).

There is exactly **one** thing the API cannot do over HTTP, by deliberate design:
grant super-admin. `isSuperAdmin` was `input: false` in the Node era and the
native auth surface keeps that posture, so it is settable only in the database.
`Fixtures/SuperAdminGrant.cs` owns that single
non-HTTP step - a lone parameterized `UPDATE "User" SET "isSuperAdmin" = true` - and
signs in *afresh* afterward so the session unambiguously reflects the promotion.
It connects with
`NODESCOPE_DATABASE_URL` (a libpq URL or a native Npgsql string; default is the
contract-test DB, `postgresql://nodescope:localdevpassword@localhost:5433/nodescope_test`)
- this **must** name the same database the target under test writes to.

The seed (`scripts/run-csharp-host.sh seed`) creates:

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
  ApiResponse.cs         captured status/headers + parsed JSON, envelope helpers
  Auth.cs                bearer | header credential descriptor
  AuthWorkflow.cs        sign-up / sign-in helpers -> UserSession (bearer session token)
  OrgProvisioning.cs     super-admin bootstrap + per-test org (-> ProvisionedOrg)
  SuperAdminGrant.cs     the one non-HTTP step: the super-admin DB grant (Npgsql)
  ContractApiFixture.cs  shared client + health gate + run-scoped super-admin (collection "Contract")
  RealtimeClient.cs      semantic realtime test contract
  SignalRRealtimeClient.cs public SignalR wire adapter
Identity/                auth, users, organizations, and access contracts
Realtime/                SignalR event routing and isolation contracts
```

Responses are asserted as `JsonElement` rather than typed DTOs. The suite
references `NodeScope.Contracts` for stable cross-process constants and agent
contracts, while black-box assertions keep the public JSON shape under test.
