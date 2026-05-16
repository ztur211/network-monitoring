# NodeScope — Build Progress

Last updated: 2026-05-15

---

## Phases at a Glance

| Phase | Title | Status |
|---|---|---|
| 0 | Foundation | ✅ Complete |
| 1 | Authentication | ✅ Complete |
| 2 | Core Data Layer | ✅ Complete |
| 3 | Real-Time Infrastructure | ✅ Complete |
| 4 | Browser Collector | ✅ Complete |
| 5 | Map & GIS | ✅ Complete |
| 6 | AI Assistant | ⬜ Not started |
| 7 | Clients, Circuits & Settings | ⬜ Not started |
| 8 | Integration & UI Honesty Audit | ⬜ Not started |
| 9 | Hardening & Production Readiness | ⬜ Not started |

---

## Phase 0 — Foundation ✅

**Commit:** `defd221 chore: initialize NodeScope monorepo scaffold`

### What was built
- **Monorepo structure** — npm workspaces with `apps/api`, `apps/web`, `packages/shared`
- **Docker** — `docker-compose.yml` (PostgreSQL + TimescaleDB + PostGIS + Redis) and `docker-compose.test.yml` (isolated test DB on separate port, tmpfs)
- **Prisma schema** — all MVP models: User, Account, Session, Verification, Device, DeviceConnection, FiberRun, Circuit, DeviceMetric, ChangeLog; all enums; post-MVP models commented out
- **NestJS bootstrap** — `main.ts` with Helmet, compression, CORS, ValidationPipe, global prefix `/api`
- **`app.module.ts`** — imports wired (modules implemented in Phase 1 session)
- **Expo Web** — `apps/web` scaffold with NativeWind, route groups `(auth)/` and `(app)/`, placeholder screens
- **Shared package** — `packages/shared` with `auth.types.ts`, `device.types.ts`, `metrics.types.ts`
- **CI** — `.github/workflows/ci.yml`
- **Environment** — `.env.example` with all required variables documented

### Notes
The NestJS modules referenced in `app.module.ts` (PrismaModule, RedisModule, TimescaleModule, HealthModule) were scaffolded as imports but their implementation files were created during Phase 1.

---

## Phase 1 — Authentication ✅

**Commit:** `0492d04 feat: implement Phase 1 — Authentication`

### What was built

#### Missing Phase 0 modules (created as prerequisite)

| File | Purpose |
|---|---|
| `src/prisma/prisma.service.ts` | `PrismaService` extends `PrismaClient`; exports `prisma` singleton for Better Auth |
| `src/prisma/prisma.module.ts` | Global module, exports `PrismaService` |
| `src/redis/redis.service.ts` | `RedisService` extends `ioredis` Redis |
| `src/redis/redis.module.ts` | Global module, exports `RedisService` |
| `src/timescale/timescale.service.ts` | Runs idempotent startup SQL: hypertable, compression, retention. Fatal on hypertable failure, warn on policy failure |
| `src/timescale/timescale.module.ts` | Imports PrismaModule |
| `src/health/health.controller.ts` | `GET /api/health` — public, skips throttle, pings DB + Redis |
| `src/health/health.module.ts` | |

#### Jest configuration

| File | Matches |
|---|---|
| `jest.unit.config.ts` | `*.service.spec.ts` |
| `jest.integration.config.ts` | `*.repository.spec.ts` |
| `jest.e2e.config.ts` | `*.e2e.ts` |

All configs use `moduleNameMapper` to resolve `@nodescope/shared` from TypeScript source (no build step needed for tests).

#### Auth module

| File | Purpose |
|---|---|
| `src/auth/better-auth.config.ts` | Better Auth configured with Argon2id, 30-day sessions, 5-min cookieCache. **`input: false`** on `tier`, `homeLatitude`, `homeLongitude` — prevents users from self-assigning tier on sign-up |
| `src/auth/auth.controller.ts` | `@All('auth/*path')` — passes all `/api/auth/*` requests to `toNodeHandler(auth)`. Throttled 5 req/15 min per IP, skips the default 100/min throttle |
| `src/auth/auth.module.ts` | |
| `src/auth/guards/auth.guard.ts` | Global via `APP_GUARD`. Calls `auth.api.getSession({ headers: fromNodeHeaders(...) })`, attaches `request.user` and `request.session`. Skips on `@Public()` |
| `src/auth/guards/tier.guard.ts` | Reads `request.user.tier` (set by AuthGuard), compares against `@RequireTier()`. No DB lookup. No active endpoints in MVP |
| `src/auth/guards/role.guard.ts` | Reads org role from session. Structurally complete; no active endpoints in MVP |
| `src/auth/decorators/public.decorator.ts` | `@Public()` — opts a route out of AuthGuard |
| `src/auth/decorators/current-user.decorator.ts` | `@CurrentUser()` — injects `request.user` |
| `src/auth/decorators/current-session.decorator.ts` | `@CurrentSession()` — injects `request.session` |
| `src/auth/decorators/require-tier.decorator.ts` | `@RequireTier(tier)` — marks minimum tier |
| `src/auth/decorators/require-role.decorator.ts` | `@RequireRole(role)` — marks minimum org role |
| `src/types/express.d.ts` | Augments `Express.Request` with typed `user` and `session` properties |

#### Common

| File | Purpose |
|---|---|
| `src/common/filters/global-exception.filter.ts` | `APP_FILTER`. Handles `ThrottlerException` → GEN_004, `NodeScopeException` and guard errors with `{ code, message }` body → their specific code, `ValidationPipe` errors → GEN_001, 401 → AUTH_002, 404 → GEN_002, fallthrough → GEN_003. **`NodeScopeException`** is the base class all services throw |

#### Users module (TDD — tests written first)

| File | Purpose |
|---|---|
| `src/users/__tests__/users.service.spec.ts` | Unit tests: getMe, updateMe (name, email-taken check), setLocation (coords + address geocoding) |
| `src/users/__tests__/users.repository.spec.ts` | Integration tests against real test DB: findById, update, updateLocation, existsByEmail |
| `src/users/__tests__/users.controller.e2e.ts` | E2E: GET /me (200 + 401), PATCH /me, POST /location |
| `src/users/users.dto.ts` | `UpdateMeDto` (name, email), `SetLocationDto` (address or lat+lng) |
| `src/users/users.repository.ts` | `findById`, `update`, `updateLocation`, `existsByEmail` — only file that calls Prisma |
| `src/users/users.service.ts` | Business logic: checks email uniqueness before update, geocodes address via `GeocodingProvider`, `toDto()` mapper |
| `src/users/users.controller.ts` | `GET /api/v1/users/me`, `PATCH /api/v1/users/me`, `POST /api/v1/users/location` |
| `src/users/users.module.ts` | Imports MapModule to access GEOCODING_PROVIDER |

#### App module updates

`app.module.ts` wires:
- `ThrottlerModule` — `default` (100 req/min) + `auth` (5 req/15 min)
- `APP_FILTER` → `GlobalExceptionFilter`
- `APP_GUARD` chain: `AuthGuard` → `ThrottlerGuard` → `TierGuard` → `RoleGuard` (order matters)
- `AuthModule`, `UsersModule`

#### Shared package additions

`packages/shared/src/types/api.types.ts`:
- `AccountTier` union type
- `UserDto` interface
- `ChangesetDto` / `ChangesetChangeDto`
- `ApiSuccess<T>` / `ApiError` response envelopes
- `PaginatedResponse<T>` / `CursorPaginatedResponse<T>`

#### Frontend

| File | Purpose |
|---|---|
| `lib/auth-client.ts` | `createAuthClient` from `better-auth/react`, baseURL from `EXPO_PUBLIC_API_URL` |
| `store/auth.store.ts` | Zustand: `{ user, isAuthenticated, isLoading, setUser, setLoading, clearAuth }` |
| `lib/api.service.ts` | Axios instance with `withCredentials: true`, `AUTH_002` interceptor redirects to `/login` |
| `app/_layout.tsx` | Root layout: calls `authClient.getSession()` once on mount, populates `auth.store`, shows `<Stack>` |
| `app/index.tsx` | Shows spinner while loading, then redirects to `/(app)/map` or `/(auth)/login` |
| `app/(app)/_layout.tsx` | Auth guard: verifies session on mount, redirects to `/login` if null, shows loading state |
| `app/(auth)/login.tsx` | Sign-in form: React Hook Form + Zod, calls `authClient.signIn.email()`, populates store |
| `app/(auth)/register.tsx` | Sign-up form: same pattern, calls `authClient.signUp.email()` (autoSignIn = true) |

### Auth endpoints (managed by Better Auth, not NestJS controllers)

| Endpoint | Notes |
|---|---|
| `POST /api/auth/sign-up/email` | Creates User + Account + Session; sets `better-auth.session_token` cookie; tier defaults to `PERSONAL_FREE` |
| `POST /api/auth/sign-in/email` | Creates Session row; sets cookie |
| `POST /api/auth/sign-out` | Deletes Session row; clears cookie |
| `GET /api/auth/get-session` | Returns `{ user, session }` or `null` |
| `POST /api/auth/forget-password` | Always 200 (prevents enumeration) |
| `POST /api/auth/reset-password` | Revokes all sessions on success |

---

## Phase 2 — Core Data Layer ✅

**Implemented:** 2026-05-15

### What was built

#### Shared types additions (`packages/shared/src/types/api.types.ts`)
- `ConnectionType` union type (`'ETHERNET' | 'FIBER' | 'WIFI' | 'LOGICAL'`)
- `DeviceDto`, `FiberRunDto`, `CircuitDto`, `DeviceConnectionDto` interfaces

#### TiersModule (`src/tiers/`)
- `tiers.service.ts` — `getDeviceLimit(tier): number`; `FREE_TIER_DEVICE_LIMIT = 50` (env-configurable via `FREE_TIER_DEVICE_LIMIT`)
- Unit test written first

#### ConflictResolutionModule (`src/conflict/`)
- `conflict.service.ts` — `buildUpdatePayload(changeset, writableFields, currentVersion)` (validates version + field writability, returns update object); `publishEntityUpdate(entityType, entityId, userId)` (publishes to Redis `nodescope:entity:updated` channel for Phase 3 RealtimeModule to consume)
- Unit test written first

#### DevicesModule (`src/devices/`)

| File | Purpose |
|---|---|
| `devices.dto.ts` | `CreateDeviceDto`, `PatchDeviceDto`, `DEVICE_WRITABLE_FIELDS` |
| `devices.repository.ts` | `findAllByUserId`, `countByUserId`, `findByIdAndUserId`, `create`, `updateWithVersion` (optimistic concurrency via `updateMany`), `deleteByIdAndUserId`, `existsByNameCaseInsensitive` |
| `devices.service.ts` | `listDevices`, `createDevice` (tier limit + name uniqueness), `getDevice`, `updateDevice` (changeset + name uniqueness), `deleteDevice` |
| `devices.controller.ts` | `GET /api/v1/devices`, `POST /api/v1/devices`, `GET /api/v1/devices/:id`, `PATCH /api/v1/devices/:id`, `DELETE /api/v1/devices/:id` |
| Tests | Unit + integration + E2E written before implementation |

#### FiberRunsModule (`src/fiber-runs/`)

| Endpoint | Notes |
|---|---|
| `GET /api/v1/fiber-runs` | Optional `?deviceId` filter (start or end device) |
| `POST /api/v1/fiber-runs` | Validates `startDeviceId ≠ endDeviceId` (FIBER_002), both devices owned by user |
| `GET /api/v1/fiber-runs/:id` | |
| `PATCH /api/v1/fiber-runs/:id` | Writable: `name`, `cableType`, `lengthMeters`, `notes` only — device IDs immutable |
| `DELETE /api/v1/fiber-runs/:id` | |

#### DeviceConnectionsModule (`src/connections/`)

| Endpoint | Notes |
|---|---|
| `GET /api/v1/device-connections` | Optional `?deviceId` filter (source or target) |
| `POST /api/v1/device-connections` | Validates `sourceDeviceId ≠ targetDeviceId` (CONN_002), duplicate check (CONN_003) |
| `PATCH /api/v1/device-connections/:id` | Writable: `connectionType`, `notes` only — device IDs immutable |
| `DELETE /api/v1/device-connections/:id` | |

#### CircuitsModule (`src/circuits/`)

| Endpoint | Notes |
|---|---|
| `GET /api/v1/circuits` | Cursor-based pagination — `?limit&cursor`. nextCursor = base64 JSON `{ createdAt, id }` |
| `POST /api/v1/circuits` | Validates `deviceId` belongs to user if provided |
| `GET /api/v1/circuits/:id` | |
| `PATCH /api/v1/circuits/:id` | All fields writable including `deviceId` (can set to null to unlink device) |
| `DELETE /api/v1/circuits/:id` | Circuit remains after device delete (Prisma SetNull) |

#### MapModule (`src/map/`)

| File | Purpose |
|---|---|
| `geocoding/geocoding.interface.ts` | `GeocodingProvider` interface + `GEOCODING_PROVIDER` injection token |
| `geocoding/nominatim.adapter.ts` | Nominatim implementation with 1.1s rate limit enforcer (Nominatim ToS). Uses native `fetch`. |
| `map.repository.ts` | `findDevicesInBbox` (PostGIS `ST_Within` + `ST_MakeEnvelope`), `findFiberRunsInBbox` (JOIN on device location), `findCircuitsInBbox` (JOIN on associated device location) — all via `prisma.$queryRaw` |
| `map.service.ts` | `getDevicesInBbox`, `getFiberRunsInBbox`, `getCircuitsInBbox` — parses and validates bbox string |
| `map.controller.ts` | `GET /api/v1/map/devices`, `/map/fiber-runs`, `/map/circuits` |
| `map.module.ts` | Exports `MapService` and `GEOCODING_PROVIDER` (for `UsersModule`) |

#### Updated files
- `users.service.ts` — now injects `GEOCODING_PROVIDER` and calls `geocodingProvider.geocode(address)` in `setLocation`
- `users.module.ts` — imports `MapModule`
- `users.service.spec.ts` — updated to mock `GEOCODING_PROVIDER`; added geocoding test cases
- `app.module.ts` — wires `TiersModule`, `ConflictResolutionModule`, `DevicesModule`, `FiberRunsModule`, `ConnectionsModule`, `CircuitsModule`, `MapModule`

#### Seed (`apps/api/prisma/seed.ts`)
- Creates dev user via Better Auth `signUpEmail`
- Seeds 5 devices (Core Router, Core Switch, Office AP, File Server, Firewall) with lat/lng
- Seeds 2 connections (Router→Switch, Switch→Server)
- Seeds 1 fiber run (MDF to IDF, OS2 Singlemode, 45.5m)
- Seeds 1 circuit (Comcast Business, 1 Gbps Fiber, linked to Router)
- Idempotent: skips if user or devices already exist

#### Frontend
- `app/(app)/equipment.tsx` — placeholder screen
- `app/(app)/circuits.tsx` — placeholder screen
- `store/device.store.ts` — Zustand stub: `devices`, `isLoading`, `error`, `setDevices`, `upsertDevice`, `removeDevice`

### Architecture notes
- **Optimistic concurrency:** All feature repositories use `updateMany({ where: { id, userId, version } })` — 0 rows → SYNC_001
- **Event bus (Phase 2 side):** `ConflictResolutionService.publishEntityUpdate()` publishes to Redis `nodescope:entity:updated`. Phase 3 RealtimeModule will subscribe and emit WebSocket events.
- **Module order in `app.module.ts`:** `MapModule` before `UsersModule` — ensures `GEOCODING_PROVIDER` is registered when UsersModule resolves it

---

## Setup — Before First Run

```bash
# 1. Install all workspace dependencies
npm install

# 2. Copy environment file and fill in values
cp .env.example .env

# 3. Start local services
docker compose up -d

# 4. Apply DB migrations (includes PostGIS extension + geometry column + ChangeLog constraint)
npx prisma migrate dev --schema=apps/api/prisma/schema.prisma

# 5. Generate Prisma client
npx prisma generate --schema=apps/api/prisma/schema.prisma

# 6. Seed dev user (requires SEED_PASSWORD env var)
npx prisma db seed --schema=apps/api/prisma/schema.prisma

# 7. Start API dev server
npm run dev --workspace=apps/api

# 8. Start web app
npm run dev --workspace=apps/web
```

### Test commands

```bash
# Unit tests (no DB required)
npm run test:unit --workspace=apps/api

# Integration tests (requires test DB: docker compose -f docker-compose.test.yml up -d)
npm run test:integration --workspace=apps/api

# E2E tests (requires test DB + running services)
npm run test:e2e --workspace=apps/api
```

---

## Phase 3 — Real-Time Infrastructure ✅

**Implemented:** 2026-05-15

### What was built

#### Shared types additions (`packages/shared/src/types/realtime.types.ts`)
- `WS_EVENTS` const object — all 17 WebSocket event names as typed constants (no magic strings anywhere)
- `ConnectionStatus` union type (`'connected' | 'reconnecting' | 'offline'`)
- `MetricsDto`, `ConnectionStatusPayload`, `WsErrorPayload` interfaces

#### RealtimeModule (`src/realtime/`)

| File | Purpose |
|---|---|
| `realtime.types.ts` | `REALTIME_SERVICE` injection token, `IRealtimeService` interface, Redis key helpers |
| `realtime.gateway.ts` | `@WebSocketGateway` + `IRealtimeService` implementation; handles connect/disconnect/ping; push scheduler with Redis distributed lock; configures Socket.io Redis adapter in `afterInit` |
| `realtime.module.ts` | Imports RedisModule; provides `RealtimeGateway`; exports `REALTIME_SERVICE` (useExisting) and `RealtimeGateway` for Phase 4 injection |

**Gateway connection lifecycle:**
- `handleConnection`: calls `auth.api.getSession({ headers: fromNodeHeaders(handshake.headers) })` — same lookup as HTTP AuthGuard. Stores `session.user` in `socket.data`. Joins `user:{userId}` + `tier:{tier}` rooms. Records socket in Redis Set `nodescope:connections:{userId}`.
- `handleDisconnect`: removes socket from Redis Set.
- `v1:ping` → `v1:pong` via `@SubscribeMessage` + `WsResponse`.

**Push scheduler:**
- Fires every `REFRESH_INTERVAL_SECONDS` (default 30).
- Acquires `nodescope:lock:push_scheduler` Redis lock (`SET ... NX EX`) to ensure only one instance runs per cycle.
- Phase 3: no-op body — DataSourcesModule not yet wired.
- Phase 4: will call `DataSourcesService.getLatestMetrics()` and emit `v1:metrics:update` to each user's room.

**Redis adapter:**
- Configured in `afterInit` via `@socket.io/redis-adapter` `createAdapter(pubClient, subClient)` using two ioredis `duplicate()` clients.
- Enables multi-instance WebSocket routing (any instance can push to any connected user).

#### Frontend

| File | Purpose |
|---|---|
| `store/ui.store.ts` | Zustand: `connectionStatus`, `latency`, `lastContactAt`; `setConnectionStatus`, `setLatency` |
| `lib/websocket.service.ts` | Singleton Socket.io client; `withCredentials: true`; reconnection state machine (5 attempts → offline → 30s retry); ping loop every 25s; updates `ui.store` on events |
| `components/OfflineBanner.tsx` | Renders when `connectionStatus !== 'connected'`; yellow for reconnecting, red for offline; shows last-contact time |
| `app/(app)/_layout.tsx` | Updated: calls `websocketService.connect()` after session verified; `websocketService.disconnect()` on unmount; wraps `<Stack>` in `<OfflineBanner>` |

#### Tests (written before implementation)

| File | Level | Covers |
|---|---|---|
| `realtime/__tests__/realtime.service.spec.ts` | Unit | `pushToUser`, `pushToTier`, `pushToOrg`, `getConnectionStatus` |
| `realtime/__tests__/realtime.gateway.e2e.ts` | E2E | WS connection with valid session, rejection with no session, `v1:ping` → `v1:pong`, Redis `sadd`/`srem` on connect/disconnect |

### Architecture notes
- **No direct Socket.io calls outside `RealtimeGateway`**: all other modules call `IRealtimeService` via the `REALTIME_SERVICE` injection token.
- **Entity WS events deferred to Phase 4**: `ConflictResolutionService` still publishes to Redis `nodescope:entity:updated`. Phase 4 wires `RealtimeService` into `ConflictResolutionModule` to emit full entity payloads (`v1:device:updated` etc.) after successful PATCH operations.
- **`REALTIME_SERVICE` exported**: Phase 4 and Phase 6 modules inject it via `@Inject(REALTIME_SERVICE)`.

---

---

## Phase 4 — Browser Collector ✅

**Implemented:** 2026-05-16

### What was built

#### Shared types fixes
- `packages/shared/src/types/metrics.types.ts` — Renamed `MetricsDto` → `MetricRowDto` (DB row shape) to eliminate duplicate with `realtime.types.ts MetricsDto` (WS event shape)

#### Entity WebSocket events wired (ConflictResolutionModule)
- `conflict.service.ts` — Added `emitEntityEvent(event, payload, userId)` method; injects `REALTIME_SERVICE` (via `@Inject`)
- `conflict.module.ts` — Now imports `RealtimeModule` to satisfy `REALTIME_SERVICE` injection
- All four entity services updated to call `emitEntityEvent` with full entity payload after PATCH/DELETE:
  - `DevicesService` → `v1:device:updated` (with full `DeviceDto` + changes) and `v1:device:deleted`
  - `CircuitsService` → `v1:circuit:updated` and `v1:circuit:deleted`
  - `FiberRunsService` → `v1:fiber-run:updated` and `v1:fiber-run:deleted`
  - `ConnectionsService` → `v1:connection:updated` and `v1:connection:deleted`

#### DataSourcesModule (`src/data-sources/`)
| File | Purpose |
|---|---|
| `data-sources.interface.ts` | `DataSourceCollector` interface, `MetricRecord`, `DataSourceStatus`, `RawMetricPayload` types |
| `data-sources.repository.ts` | `createMetric`, `findLatestForUser`, `findLatestForUsers` (batch via DISTINCT ON) |
| `data-sources.service.ts` | `ingest(userId, raw)` (parses + writes), `getLatestMetric(userId)`, `getLatestMetrics([userIds])` (batch → Map), `getDataSourceStatus(userId)` (connected/lastSeen based on 90s threshold) |
| `data-sources.module.ts` | Imports PrismaModule; exports DataSourcesService |
| Tests | Unit tests for service (mocking repository), integration tests for repository methods |

#### RealtimeGateway — Phase 4 wiring
- Injects `DataSourcesService`
- `handleMetricsSubmit` (`@SubscribeMessage(v1:metrics:submit)`) — extracts userId from `socket.data` (never from payload), calls `dataSourcesService.ingest`
- `runPushScheduler` — calls `pushLatestMetricsToConnectedUsers()`: fetches connected socket userIds, batch-queries TimescaleDB, emits `v1:metrics:update` to each user's room
- `realtime.module.ts` now imports `DataSourcesModule`

#### ClientsModule (`src/clients/`)
| File | Purpose |
|---|---|
| `clients.service.ts` | `getClients(userId, userAgent)` — latest metric from TimescaleDB, platform parsed from user-agent, `agentStatus.available` always false with honest post-MVP message |
| `clients.controller.ts` | `GET /api/v1/clients` |
| `clients.module.ts` | Imports DataSourcesModule |

#### UsersModule updates
- `GET /api/v1/users/me/data-sources` endpoint added
- `UsersService.getDataSources(userId)` delegates to `DataSourcesService.getDataSourceStatus`
- `UsersModule` now imports `DataSourcesModule`

#### Frontend
| File | Purpose |
|---|---|
| `store/realtime.store.ts` | Zustand: `metrics`, `sourceTypes`, `setMetrics`, `isStale()` (90s threshold) |
| `lib/browser-collector.service.ts` | Measures latency (ping/pong), bandwidth (timed fetch to /api/health), connection quality (Network Information API); emits `v1:metrics:submit` every 30s while tab visible; pauses on tab hidden (Page Visibility API) |
| `components/Timestamp.tsx` | Displays "Last updated X ago", stale styling when past threshold |
| `components/StaleDataOverlay.tsx` | Dims content with 40% opacity when stale |
| `app/(app)/_layout.tsx` | Now starts `browserCollectorService` and subscribes to metrics updates on session verified |

#### Infrastructure fixes
- `prisma/schema.prisma` — Removed invalid `metrics DeviceMetric[]` relation from Device model (DeviceMetric has no deviceId FK by design); commented out `orgMember OrganizationMember?` (post-MVP model not yet active)
- `jest.unit.config.ts`, `jest.e2e.config.ts`, `jest.integration.config.ts` — Fixed `@nodescope/shared` path (was 2 levels up, needed 3); added `better-auth`, `better-auth/node`, `better-auth/adapters/prisma` moduleNameMapper entries to handle ESM imports in test environment
- `__mocks__/better-auth-node.ts`, `better-auth.ts`, `better-auth-prisma.ts` — Mock files for jest
- Added `@types/jest` to api devDependencies

### Phase 4 completion criteria verified
- All 74 unit tests pass (10 suites)
- Entity WS events wired: PATCH/DELETE on Devices, Circuits, FiberRuns, Connections all call `emitEntityEvent`
- `DataSourcesService.ingest` writes to DeviceMetric hypertable via repository
- Push scheduler calls `getLatestMetrics` batch query and emits `v1:metrics:update`
- `GET /api/v1/clients` returns `currentDevice` with metrics and `agentStatus.available: false`
- `GET /api/v1/users/me/data-sources` returns browser source status
- Frontend browser collector emits `v1:metrics:submit` every 30s while visible
- `realtime.store` updates on `v1:metrics:update`
- `Timestamp` and `StaleDataOverlay` components implemented

---

---

## Phase 5 — Map & GIS ✅

**Commit:** `47f0bf0 feat: implement Phase 5 — Map & GIS`

**Implemented:** 2026-05-15

### What was built

#### MapView.tsx (`apps/web/components/map/MapView.tsx`)
- Single maplibre-gl import boundary (only file that touches MapLibre SDK)
- Injects MapLibre CSS via link element (CDN, maplibre-gl@4.7.1)
- Initializes map centered on stored position → user home location → world view fallback
- Viewport loading: `GET /api/v1/map/devices?bbox=` + `GET /api/v1/map/fiber-runs?bbox=` on `moveend`, debounced 300ms, AbortController cancels in-flight requests
- Zoom filter: DEVICE_CATEGORY_CONFIG minZoom applied client-side per device category
- Floor filter: single/all/connection display modes; non-selected floors dimmed 30% opacity
- Layer toggle filter: per-category visibility from ui.store
- Fiber run GeoJSON source + line layer (orange dashed, minzoom 13)
- Live marker via `navigator.geolocation` with CSS pulse animation
- Marker sync: adds/removes/updates maplibregl.Marker instances as visibleDevices changes
- Persists mapCenter and mapZoom to localStorage via ui.store

#### DeviceMarker.tsx (`apps/web/components/map/DeviceMarker.tsx`)
- Creates DOM elements for device markers (no maplibregl import — SADrule compliant)
- Category colors: blue (ISP), orange (Core), red (Firewall), green (Network), purple (Server), teal (End-User), gray (Custom)
- Category abbreviations: RT, SW, AP, FW, etc.
- Selected state: larger border, scale 1.1

#### LiveMarker.tsx (`apps/web/components/map/LiveMarker.tsx`)
- DOM element with CSS pulse ring + core dot
- Injects @keyframes ns-pulse once per page

#### FloorSelector.tsx (`apps/web/components/map/FloorSelector.tsx`)
- Hidden when no devices have floor set
- Display modes: All / One (single) / Conn (connection view)
- Lists floors in descending order; "All floors" option at top

#### MapControls.tsx (`apps/web/components/map/MapControls.tsx`)
- Zoom label: "City view" / "ISP equipment" / "Core infrastructure" / "Network equipment" / "All devices"
- Expandable panel with per-category checkboxes
- Shows minZoom hint (z10+, z13+) when category is below zoom threshold
- Persisted to localStorage via ui.store

#### DeviceDetailPanel.tsx (`apps/web/components/map/DeviceDetailPanel.tsx`)
- Bottom-sheet with handle, header, scroll body, action buttons
- Shows: name, category, floor, IP, MAC, location coords, notes, version, added date
- Edit → opens DeviceForm in edit mode; Delete → confirms then calls deleteDevice

#### DeviceLimitBanner.tsx (`apps/web/components/map/DeviceLimitBanner.tsx`)
- Warns at 45 devices (yellow); blocks message at 50 (red)

#### DeviceForm.tsx (`apps/web/components/DeviceForm.tsx`)
- React Hook Form + Zod validation matching API Design Section 5
- Fields: name, category (horizontal chip picker), lat, lng, floor, floorLabel, IP, MAC, notes
- Edit mode: pre-fills from DeviceDto, builds changeset (field-level diff) for PATCH
- Create/edit submission delegates to device.store.createDevice / updateDevice

#### Stores updated
- **ui.store.ts**: mapCenter, mapZoom, layerToggles (Record\<DeviceCategory, boolean\>), selectedFloor, floorDisplayMode; all map state localStorage-persisted
- **device.store.ts**: `loaded` flag, `offlineQueue`, `loadDevices()`, `createDevice()` (optimistic, rollback on failure → queue), `updateDevice()` (buildChangeset, optimistic, rollback → queue), `deleteDevice()` (optimistic, rollback → queue), `flushOfflineQueue()`

#### Screens
- **map.tsx**: full map screen; loads devices on mount; FAB to create; DeviceDetailPanel on marker click; DeviceForm modal for create/edit; DeviceLimitBanner overlay
- **equipment.tsx**: FlatList of all devices; search, category filter (chip groups), floor filter; inline DeviceForm for create/edit; DeviceLimitBanner

#### _layout.tsx updated
- Subscribes to `v1:device:updated` → upsertDevice in device.store
- Subscribes to `v1:device:deleted` → removeDevice from device.store
- Flushes offline queue on WS reconnect

### Architecture notes
- **maplibregl only in MapView.tsx**: DeviceMarker.tsx and LiveMarker.tsx create DOM elements without importing maplibregl — fully compliant with SAD 5.5 / SAD 9.2
- **Two-layer device state**: viewport API loads upsert into device.store; client-side bbox+zoom+floor+layer filtering applied to device.store.devices for the map
- **Offline queue**: failed CUD ops queued in device.store.offlineQueue; flushed on WS reconnect event in _layout.tsx
- **Four-state components**: all data-displaying screens implement loading / loaded / stale / error states

---

## What's Next — Phase 6 (AI Assistant) or Phase 7 (Clients, Circuits & Settings)

Phases 6 and 7 can be built in parallel or sequentially. Recommended order: 6 → 7.
