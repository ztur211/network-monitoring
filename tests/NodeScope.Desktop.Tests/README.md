# NodeScope.Desktop.Tests

The desktop suite combines headless view-model and view tests with opt-in tests
that drive a running appliance through the same API and SignalR clients used by
the Avalonia application.

Run the self-contained suite:

```bash
dotnet test tests/NodeScope.Desktop.Tests -c Release
```

Live tests report as skipped unless their environment variable is set. They
currently run on Linux and use the development plain-file token vault. All live
classes share the `LiveApplianceE2E` collection so mutations against one
appliance run sequentially.

## Live Appliance Matrix

| Test | Required environment | Appliance state |
| --- | --- | --- |
| Native authentication | `NODESCOPE_DESKTOP_E2E_BASE_URL` | Current API and test database |
| Organization bootstrap and invitation | `NODESCOPE_DESKTOP_ORGANIZATION_E2E_BASE_URL`, `NODESCOPE_DESKTOP_BOOTSTRAP_TOKEN` | Exclusive database with zero organizations |
| Map rendering | `NODESCOPE_DESKTOP_MAP_E2E_BASE_URL` | Demo seed and built map region |
| Inventory CRUD | `NODESCOPE_DESKTOP_INVENTORY_E2E_BASE_URL` | Demo seed |
| Settings and SNMP | `NODESCOPE_DESKTOP_SETTINGS_E2E_BASE_URL` | Demo seed |
| Realtime updates | `NODESCOPE_DESKTOP_REALTIME_E2E_BASE_URL` | Demo seed |
| Assistant fallback | `NODESCOPE_DESKTOP_ASSISTANT_E2E_BASE_URL` | Demo seed |

The demo-backed tests default to `owner@acme.test` and
`devpassword123`. Each suite accepts matching `_EMAIL` and `_PASSWORD`
variables, such as `NODESCOPE_DESKTOP_INVENTORY_E2E_EMAIL`. The map test also
accepts `NODESCOPE_DESKTOP_MAP_E2E_SHOT` to retain its rendered PNG.

Start a demo appliance with [the local setup guide](../../SETUP.md#quick-start).
Start the disposable API used by the authentication test with
[the contract-test recipe](../NodeScope.ContractTests/README.md#running-it).

Run one live class explicitly:

```bash
NODESCOPE_DESKTOP_INVENTORY_E2E_BASE_URL=http://localhost:8080 \
  dotnet test tests/NodeScope.Desktop.Tests -c Release \
  --filter FullyQualifiedName~InventoryE2ETests
```

Do not point the organization access test at a seeded or shared database. It
consumes the one-time first-organization transition, then creates two real
accounts and memberships.
