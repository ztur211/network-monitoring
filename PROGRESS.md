# NodeScope — Build Progress

Last updated: 2026-05-31

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
| 6 | AI Assistant | ✅ Complete |
| 7 | Clients, Circuits & Settings | ✅ Complete |
| 8 | Integration & UI Honesty Audit | ✅ Complete |
| 9 | Hardening & Production Readiness | 🟡 Code complete — cloud setup pending |
| 9b | Dependency Currency (Expo 55 / RN 0.85 / argon2 0.44) | 🟡 Code complete + bundle under target — needs in-browser smoke test |
| 9c | Deployment Hardening (.do/app.yaml + post-deploy smoke test) | 🟢 Code complete |
| 9d | Schema-drift fixes + Dead-code sweep (MULTI_PROPERTY, Prisma enum dedupe, unused-export removal) | 🟢 Code complete |
| 9e | First-run shakedown (map render, /clients crash, browser-collector bandwidth endpoint, RN-Web 0.21 fallout) | 🟢 Code complete |
| 10 | Post-MVP session 2026-05-18/19: drag-after-tab-switch fix, building footprints toggle, cross-device map prefs sync | 🟢 Code complete |

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

---

## Phase 6 — AI Assistant ✅

**Implemented:** 2026-05-15

### What was built

#### Shared types (`packages/shared/src/types/ai.types.ts`)
- `AiMessageResponseDto`, `AiUsageDto`, `ConversationMessage`

#### Product knowledge (`docs/product-knowledge/`)
- `devices.md`, `map.md`, `circuits.md`, `ai-assistant.md`, `roadmap.md`
- Loaded at startup by `ProductContextProvider`, cached in memory

#### AiModule (`src/ai/`)

**Adapters:**
- `AiProviderAdapter` interface + `AI_PROVIDER_TOKEN` injection token
- `ClaudeAdapter` — uses `@anthropic-ai/sdk` `messages.stream()` + `finalMessage()` for streaming; `messages.create()` for sync
- `OpenAICompatibleAdapter` — uses native fetch for OpenAI-compatible endpoints (Ollama, LM Studio)
- Selected by `AI_PROVIDER` env var (`claude` default, `openai-compatible` for self-hosted)

**Context providers (4 sources):**
- `NetworkContextProvider` — queries devices, connections, fiber runs, circuits via PrismaService
- `RealtimeContextProvider` — gets latest DeviceMetric via DataSourcesService
- `AccountContextProvider` — reads user tier, lists available vs. planned features
- `ProductContextProvider` — loads `docs/product-knowledge/*.md` at OnModuleInit, caches
- `ContextBuilderService` — assembles all 4 sources + honesty system prompt preamble

**Rate limiting (6 layers):**
- `AiRateLimiterService` — 4 Redis checks in parallel (hourly, daily, monthly tokens, per-IP)
- Redis keys: `ai:rate:hourly:{userId}:{hour}`, `ai:rate:daily:{userId}:{date}`, `ai:rate:monthly_tokens:{userId}:{month}`, `ai:rate:ip:{ip}:{hour}`
- `buildUsageWarning` — warns at 80% of any limit
- `incrementUsage` — pipeline with incr/incrby + expire per counter
- Throws AI_001 (hourly/IP), AI_002 (daily), AI_003 (monthly tokens)

**Conversation management:**
- `ConversationService` — Redis key `ai:conv:{id}`, 24h TTL, max 20 message pairs
- `createConversationId()` uses `crypto.randomUUID()`

**Service and HTTP API:**
- `AiService.sendMessageHttp` — sync path: rate check → context assembly → adapter.complete() → history + usage increment → response
- `AiService.sendMessageStream` — streaming path: same flow but adapter.stream() with token callback
- Graceful fallback: catches adapter errors, builds response from assembled context, `providerStatus: 'unavailable'`
- History trimmed to fit 8000-token budget (oldest pairs dropped first)
- `GET /api/v1/ai/usage` — returns hourly/daily/monthly counts
- `DELETE /api/v1/ai/conversation/:id` — clears Redis history

**WebSocket (RealtimeGateway update):**
- `handleAiMessage` — `@SubscribeMessage(v1:ai:message)`, extracts userId from `socket.data` (never from payload)
- Emits `v1:ai:token` per chunk, `v1:ai:complete` when done
- Rate limit errors emitted as `v1:error` with code and `context: 'ai'`

#### Frontend
- `ai.store.ts` — Zustand: messages, conversationId, isStreaming, usage, providerAvailable; sendMessage, appendTokenToCurrentMessage, completeCurrentMessage
- `AiMessage.tsx` — user/assistant bubbles, streaming indicator, provider-unavailable badge, usage warning
- `AiStatusBanner.tsx` — shows when unavailable, at limit, or approaching limit
- `AiChatWindow.tsx` — message list, suggested prompts when empty, send input, usage counter
- `app/(app)/ai-assistant.tsx` — full screen wrapper
- `_layout.tsx` updated — subscribes to `v1:ai:token`, `v1:ai:complete`, `v1:error` (context: ai)

#### Tests (written before implementation)
- `ai-rate-limiter.service.spec.ts` — 10 unit tests
- `context-builder.service.spec.ts` — 4 unit tests
- `ai.service.spec.ts` — 11 unit tests
- `ai.controller.e2e.ts` — 11 E2E tests (uses overrideProvider to mock ClaudeAdapter)

#### All 99 unit tests pass (13 suites)

### Architecture notes
- `AiModule` imports PrismaModule, RedisModule, DataSourcesModule — no circular dependency
- `RealtimeModule` imports `AiModule` to give the gateway access to `AiService` for WS handling
- `AppModule` imports `AiModule` directly for HTTP endpoints
- `AI_PROVIDER_TOKEN` follows same pattern as `GEOCODING_PROVIDER` in MapModule
- Context providers injected via Symbol tokens (NETWORK_CONTEXT_PROVIDER etc.) matching the `@Inject()` decorators in ContextBuilderService

---

---

## Phase 7 — Clients, Circuits & Settings ✅

**Implemented:** 2026-05-15

### What was built

#### Backend
- `GET /api/v1/clients` — implemented in Phase 4; verified `agentStatus.message` clearly describes the Agent as upcoming (Priority 1 post-MVP)
- Circuit CRUD (`GET`, `POST`, `PATCH`, `DELETE /api/v1/circuits`) — implemented in Phase 2; cursor-based pagination confirmed

#### Frontend

| File | Purpose |
|---|---|
| `store/circuits.store.ts` | Zustand: cursor-paginated circuit list, optimistic CRUD, offline queue (same pattern as device.store) |
| `components/CircuitForm.tsx` | React Hook Form + Zod; fields: ispName, serviceType (chip picker), circuitId, bandwidth, deviceId (chip picker from devices.store), notes |
| `app/(app)/circuits.tsx` | Paginated FlatList with `onEndReached` auto-pagination; create/edit via Modal + CircuitForm; delete with Alert confirm |
| `app/(app)/clients.tsx` | Current device (platform, userAgent, live metrics from realtime.store); prominent Agent post-MVP info panel; four-state loading/loaded/stale/error |
| `app/(app)/settings.tsx` | Account: name/email edit (PATCH /users/me); Location: address geocode (POST /users/location); Appearance: dark mode toggle via `useColorScheme` from nativewind; Data Sources: GET /users/me/data-sources panel |
| `app/(app)/_layout.tsx` | Changed `<Stack>` to `<Tabs>` with `@expo/vector-icons` Ionicons; 6 tabs: Map, Clients, Equipment, Circuits, AI, Settings; added circuit WS subscriptions (v1:circuit:updated/deleted); flushes circuit offline queue on reconnect |

### Phase 7 completion criteria

- Circuits list loads with cursor pagination — `loadNextPage` fires on `onEndReached`
- Create circuit → optimistic update in list immediately
- Associate circuit with device → circuit appears in map viewport endpoint (`GET /api/v1/map/circuits`)
- Clients view shows current device user agent and platform
- Clients view shows Agent explanation: "Desktop Agent coming post-MVP (Priority 1)" — no status indicators for undiscovered devices
- Settings: name/email update via PATCH /users/me, reflected in auth.store
- Settings: home location set via address → geocoded and stored
- Settings: data sources panel shows browser as Active, Agent as 'Not set up'
- Navigation: all 6 screens accessible via bottom tab bar; Organization absent

### Architecture notes
- `circuits.store.ts` mirrors `device.store.ts` pattern exactly: optimistic CRUD, offline queue, `flushOfflineQueue`
- `_layout.tsx` now uses Tabs from expo-router; circuit WS events update circuits.store in real time
- `settings.tsx` updates auth.store by spreading `user` with changed fields (preserves Better Auth session shape)
- `clients.tsx` uses live `realtime.store.metrics` for fresh data; falls back to `currentDevice.metrics` from REST response

---

## Phase 8 — Integration & UI Honesty Audit ✅

**Implemented:** 2026-05-16

### What was built

#### Graceful-degradation test suite (`apps/api/src/__tests__/graceful-degradation/`)

| File | Covers (SAD §11.8) |
|---|---|
| `backend-health.e2e.ts` | Health endpoint reports `ok` / `degraded` correctly when Prisma or Redis fails; version from package.json; ISO8601 timestamp |
| `ai-fallback.e2e.ts` | `AiService` returns 200 with `providerStatus: 'unavailable'`, `tokensUsed: 0`, and fallback content when adapter throws; still propagates rate-limit `NodeScopeException`s |
| `websocket-reconnect.e2e.ts` | Gateway rejects unauthenticated handshakes; joins user/tier rooms on valid session; Redis presence add/remove; pre-auth disconnect doesn't throw; `getConnectionStatus` reflects Redis set cardinality |

All 17 graceful-degradation tests + 99 unit tests pass (16 suites total).

#### UI Honesty Audit — 11/11 items pass

| # | Checkpoint | Where verified |
|---|---|---|
| 1 | Documented markers — no green/amber/red | `DeviceMarker.tsx` — palette switched to neutral indigo/teal/slate/violet/blue/gray; comment cites PRD §10.1 |
| 2 | Current device marker visually distinct | `LiveMarker.tsx` — pulsing blue ring with `@keyframes ns-pulse`, unique vs. flat documented markers |
| 3 | Clients view: current device only, Agent described as upcoming | `clients.tsx` — info panel "Full client discovery coming post-MVP" |
| 4 | No live status indicators on equipment without live data | `equipment.tsx DeviceCard` — text only, no status pip |
| 5 | Universal timestamps on data displays | `Timestamp` component on map, equipment, circuits, clients (live metrics), settings (data sources) |
| 6 | Stale data visually distinguished | `Timestamp` turns amber past threshold; `StaleDataOverlay` dims to 40% opacity |
| 7 | AI "your device" vs "your network" | `context-builder.service.ts SYSTEM_PREAMBLE` + `realtime-context.provider.ts` note browser-only scope |
| 8 | AI "planned"/"coming soon" language | `account-context.provider.ts PLANNED_FEATURES` list; preamble forbids "available for purchase" |
| 9 | Upgrade messaging contextual, not aggressive | Only `clients.tsx` mentions post-MVP — single contextual panel |
| 10 | Outage state visible within 5s, cached data persists | `ui.store.connectionStatus` defaults to `'offline'`; WS `disconnect` → `'reconnecting'`; `OfflineBanner` always mounted; Zustand stores retain data; offline queue flushes on reconnect |
| 11 | Floor selector honesty | `FloorSelector.tsx` — connection mode renamed "Manual", blue notice "Connections are manually documented — not auto-discovered" |

#### Backend integration

- `health.controller.ts` reads version from `package.json` via `readFileSync` (replaces hardcoded `'0.1.0'`)
- All API Design §2.7 error codes flow through `GlobalExceptionFilter` via `NodeScopeException` — verified via grep audit of all service throws
- `nominatim.adapter.ts` sends `User-Agent: ${GEOCODING_USER_AGENT ?? 'NodeScope/1.0'}` on every geocode call
- Test import fixes: `import request from 'supertest'` (was `* as request`); `auth.api.getSession as unknown as jest.Mock` casts to satisfy TS strict mode

#### Frontend honesty additions

- `Timestamp` integrated into `map.tsx` (floating pill, top-left), `equipment.tsx` (header), `circuits.tsx` (header), `clients.tsx` (per metrics), with `loadedAt` tracked in `device.store` and `circuits.store`
- `MapView.tsx` listens for `error` events from MapLibre; renders amber tile-unavailable banner if `Failed to fetch` or tile error — markers still render
- `clients.tsx` — replaced always-green status dot with neutral blue indicator only when live metrics present and not stale
- `ai-assistant.tsx` subtitle clarifies scope: "Knows your documented devices & current browser metrics — not undiscovered devices"

### Architecture notes

- **No live status pips on documented entities** — only `Timestamp` and `StaleDataOverlay` communicate freshness. Status colors (green/amber/red) reserved for transport-level signals (OfflineBanner, tile error).
- **Graceful-degradation tests live at `apps/api/src/__tests__/graceful-degradation/`** — outside feature modules per SAD §11.8 ("they span both frontend and backend"). They run under `npm run test:e2e` (testRegex `*.e2e.ts`) but use mocks rather than real Postgres/Redis, so they execute in the unit timeframe.

### Open items deferred to Phase 9

- **Prisma migration not yet generated**: `apps/api/prisma/migrations/` is empty. Phase 0 migration order (`prisma migrate dev --name init --create-only` → edit SQL to add `CREATE EXTENSION postgis`, `device_location_sync` trigger, `ChangeLog entityType` check → apply) must be completed before first run. PostGIS geometry trigger verification deferred until migration exists.
- Cross-browser testing (Chrome, Firefox, Safari, iOS Safari, Android Chrome) — manual step; not blocking code.
- Bundle size measurement (target < 500KB gzipped) — manual step.
- Map-load performance (< 3s on broadband) — manual step.

---

## Phase 9 — Hardening & Production Readiness 🟡

**Implemented:** 2026-05-16 (code-side complete; cloud setup pending)

### What was built (local code)

#### Prisma initial migration (`apps/api/prisma/migrations/20260516000000_init/`)
- `migration.sql` — full schema generation: all 4 enums (AccountTier, DeviceCategory, ConnectionType, OrgRole), all 10 MVP tables, 22 indexes, 11 foreign keys
- PostGIS extension `CREATE EXTENSION IF NOT EXISTS postgis;` at top of migration
- `Device.location geometry(Point, 4326)` column added after `CREATE TABLE "Device"`
- `device_location_idx` GiST index on `location`
- `sync_device_location()` trigger function + `device_location_sync` BEFORE INSERT OR UPDATE trigger — keeps `location` in sync with `latitude`/`longitude` automatically
- `ChangeLog.entityType` check constraint: `IN ('Device', 'Circuit', 'FiberRun', 'DeviceConnection')`
- `migration_lock.toml` with `provider = "postgresql"`

#### Helmet CSP (`apps/api/src/main.ts`)
- Replaced default `helmet()` with explicit CSP directives per SAD §12.4:
  - `default-src 'self'`
  - `img-src 'self' data: blob: https://tiles.openfreemap.org`
  - `connect-src 'self' https://tiles.openfreemap.org https://nominatim.openstreetmap.org`
  - `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `worker-src 'self' blob:`
  - `frame-ancestors 'none'`
- Anthropic API intentionally **not** in `connect-src` — server-to-server only, never called from the browser
- `crossOriginEmbedderPolicy: false` — required for MapLibre tile fetches
- Bootstrap now throws if `FRONTEND_URL` is missing (was silently letting CORS reject everything)

#### Security audit
- **Secret scan:** No real API keys committed (no `sk-ant-`, no AWS keys, no inline tokens). No `.env` files in git history. Only "secret" in history is `BETTER_AUTH_SECRET=local-dev-secret-minimum-32-characters-long` which is the labeled placeholder in `.env.example`
- **`$queryRawUnsafe` audit:** confirmed never used in `apps/api/`
- **`npm audit` (production deps only):** 39 vulnerabilities (1 low, 18 moderate, 20 high). All fixes require `--force` breaking changes:
  - `expo@55.0.24` upgrade (affects @expo/cli, @expo/config, @expo/plist, @xmldom/xmldom, tar, send, @mapbox/node-pre-gyp) — high-severity vulns in dev-time tooling, do not ship in production web bundle
  - `@nestjs/core@11.1.21` upgrade — moderate-severity injection CVE in production NestJS
  - **Deferred to a follow-up**: breaking upgrades need staged adoption with Phase 8 test re-run

#### NestJS 10 → 11 upgrade (deferred follow-up, now landed)
- All `@nestjs/*` packages bumped to 11.x (`@nestjs/core@11.1.21` resolves the moderate-severity injection CVE); `@nestjs/config` 3 → 4, `@nestjs/throttler` 5 → 6, `@nestjs/terminus` 10 → 11, `@types/express` 4 → 5
- `apps/api/src/main.ts` — `import * as compression from 'compression'` → `import compression from 'compression'` (Express 5 / TS 5 ESM-interop fix; `* as` no longer callable at runtime)
- `apps/api/src/clients/clients.service.ts` — `ClientsResponseDto` now exported (consumed by type-only imports under stricter NestJS 11 type resolution)
- `apps/api/src/realtime/__tests__/realtime.gateway.e2e.ts` — `@socket.io/redis-adapter` mock rewritten to return the real `socket.io-adapter` `Adapter` class. Reason: socket.io 4.8+ (pulled in transitively by `@nestjs/platform-socket.io@11`) instantiates the adapter via `new MockAdapter(namespace)` and calls `.init()`/`.close()` on it. The old mock returned a plain object and broke the runtime contract.
- **Verification:** `nest build` clean; 118/118 unit tests pass; 17/17 graceful-degradation e2e tests pass. The remaining e2e tests (devices, circuits, fiber-runs, connections, map, users, clients, realtime gateway) fail with `Environment variable not found: DATABASE_URL` — same failure mode under NestJS 10; they require the test DB (`docker compose -f docker-compose.test.yml up -d` + `.env`), not an upgrade regression.
- **`npm audit` after upgrade:** 39 → 26 vulnerabilities (1 low, 9 moderate, 16 high). ~13 vulns eliminated, all in the NestJS dependency chain. Remaining 26 are overwhelmingly in the Expo / React Native build tooling (`@expo/cli`, `@expo/config-plugins`, `@react-native-community/cli-*`, `@xmldom/xmldom`, `postcss`, `send`) plus `tar`/`@mapbox/node-pre-gyp` via `argon2`'s native-module build step — none of these ship in the production browser bundle. Fix path is still `expo@55.0.24` / `react-native@0.85.3` (both semver-major), kept as a separate follow-up.

#### Deploy pipeline (`.github/workflows/deploy.yml`)
- Triggers on push to `main`/`master` after CI completes
- `concurrency: deploy-production` — only one production deploy at a time
- `wait-for-ci` job — uses `lewagon/wait-on-check-action` to gate on the `Build` check
- `migrate` job — runs `npx prisma migrate deploy` against `PROD_DATABASE_URL` (GitHub Actions secret), guarded by `environment: production`
- `deploy` job — uses `digitalocean/action-doctl` + `doctl apps create-deployment --wait` to trigger App Platform rolling deploy
- Required secrets documented in workflow header: `PROD_DATABASE_URL`, `DIGITALOCEAN_ACCESS_TOKEN`, `DO_APP_ID`

#### PWA manifest (`apps/web/app.json`)
- Added to `expo.web`: `name`, `shortName`, `lang`, `scope`, `themeColor #0f172a`, `backgroundColor #ffffff`, `display: standalone`, `orientation: any`, `description`
- Expo's static export now emits a proper webmanifest for "Add to Home Screen" on iOS Safari and Android Chrome

#### Production API URL config
- Verified all 4 frontend files (`api.service.ts`, `auth-client.ts`, `browser-collector.service.ts`, `websocket.service.ts`) already read `EXPO_PUBLIC_API_URL` from env with `localhost:3000` fallback — no changes needed; production builds point at production API when `EXPO_PUBLIC_API_URL` is set in the build environment

#### `README.md`
- Local setup: install → env → docker → migrate → seed → dev servers → tests
- Production deployment: DigitalOcean App Platform one-time setup (managed PG with PostGIS + Timescale extensions, managed Redis, Spaces, App Platform services, PgBouncer DATABASE_URL, Anthropic spend cap)
- GitHub Actions secrets table
- Deploy flow walkthrough
- Breaking schema change protocol (two-phase deploy)
- Monitoring alerts recommendations

### What's NOT done (cloud-side manual steps)

These require provisioning real cloud resources and cannot be automated from this repo:

1. **DigitalOcean App Platform app created** — 2 API instances, web static site
2. **DigitalOcean Managed PostgreSQL** — TimescaleDB + PostGIS extensions enabled
3. **DigitalOcean Managed Redis** — provisioned and connection string set in App Platform env
4. **DigitalOcean Spaces bucket** — for post-MVP floor plans / Agent installers
5. **All production env vars** set on App Platform service per `.env.example`
6. **Anthropic console spend cap** — set before first real production traffic
7. **GitHub Actions secrets** added to repo: `PROD_DATABASE_URL`, `DIGITALOCEAN_ACCESS_TOKEN`, `DO_APP_ID`
8. **First production deployment** — verify `GET https://app.nodescope.io/api/health` returns `ok`
9. **DNS + HTTPS** — domain pointed at App Platform load balancer, HTTPS enforced
10. **DigitalOcean monitoring alerts** — CPU >80%, memory >85%, DB connections >80%
11. **Cross-browser + bundle size + map load-time testing** — deferred manual measurement steps from Phase 8

### Architecture notes

- **CSP is intentionally restrictive.** No CDN scripts, no inline scripts. If a feature needs to fetch from a new domain, add it to `connect-src` in `main.ts` and update the SAD §12.4 list in the same PR.
- **Migration adoption.** On a fresh clone, `prisma migrate dev` will detect the manually-authored `20260516000000_init/migration.sql` and apply it. Against existing test or production databases that already have the schema applied (e.g. previously via `prisma db push`), use `npx prisma migrate resolve --applied 20260516000000_init` to mark it as already-applied without re-running.
- **`deploy.yml` waits on CI rather than chaining via `needs`** so the two workflows stay independently re-runnable (cancel/retry deploy without rerunning the full test matrix).

---

## Phase 9b — Dependency Currency 🟡

**Implemented:** 2026-05-16 (code-side complete + bundle under target; needs in-browser smoke test)

### What was built

#### Backend
- `argon2` 0.31.2 → 0.44.0 (`apps/api/package.json`). 0.44 drops `@mapbox/node-pre-gyp` and `tar` from the native-build chain in favour of `node-addon-api` + `node-gyp-build`. Removes the only `tar`-via-argon2 audit path. API surface (`hash`, `verify`, `argon2id` constant) unchanged — single import site in `better-auth.config.ts` works as-is.

#### Frontend major upgrade (`apps/web/package.json`)

| Package | Before | After |
|---|---|---|
| expo | ~51.0.28 | ~55.0.24 |
| expo-router | ~3.5.23 | ~55.0.14 |
| expo-linking | ~6.3.1 | ~55.0.15 |
| expo-constants | ~16.0.2 | ~55.0.16 |
| expo-status-bar | ~1.12.1 | ~55.0.6 |
| @expo/metro-runtime | ~3.2.3 | ~55.0.11 |
| react | 18.2.0 | 19.2.6 |
| react-dom | 18.2.0 | 19.2.6 |
| react-native | 0.74.5 | 0.85.3 |
| react-native-web | ~0.19.10 | ~0.21.2 |
| nativewind | ^4.0.36 | ^4.2.4 |
| `@types/react` | ~18.2.79 | ~19.1.1 |
| `@types/react-native` | ^0.73.0 | **removed** (RN 0.74+ ships its own types) |

New direct deps added for expo-router 55 peer requirements: `react-native-worklets@0.8.3`, `react-native-safe-area-context@5.7.0`, `react-native-screens@4.25.0`, `react-native-gesture-handler@2.31.2`, `react-native-reanimated@4.3.1`.

#### Monorepo hoisting fixes

Expo SDK 55's `babel-preset-expo` calls `hasModule('expo-router')` via plain `require.resolve` from the hoisted preset's location. With workspace-local resolution it returned false, silently disabling the expo-router babel plugin and breaking `process.env.EXPO_ROUTER_APP_ROOT` substitution. Same shape for `react-native-worklets/plugin` referenced by `react-native-reanimated`'s babel plugin.

Fixed by:
- Adding `expo-router` and `react-native-worklets` as root `devDependencies` in workspace root `package.json` — forces hoist to root `node_modules` where the preset can find them.
- New `.npmrc` with `legacy-peer-deps=true` — required because RN 0.85's strict `react@^19.2.3` peer and Better Auth's flexible peer ranges conflict during workspace resolution.
- New `apps/web/metro.config.js` — sets `projectRoot=__dirname`, `workspaceRoot=../..`, and `resolver.nodeModulesPaths` to both `node_modules` locations so Metro walks the monorepo correctly.

#### Type system fixes

- New `apps/web/nativewind-env.d.ts` — `/// <reference types="nativewind/types" />` plus explicit `declare module 'react-native'` augmentations for `ViewProps`, `TextProps`, `ImagePropsBase`, `TextInputProps`, `ScrollViewProps`, `SwitchProps`, `TouchableWithoutFeedbackProps`, `PressableProps`, `FlatListProps`, `ActivityIndicatorProps`. RN 0.85's types restructure moved `ViewProps` out of `types/index.d.ts` into `Libraries/Components/View/ViewPropTypes.d.ts`, so `react-native-css-interop@0.2.4`'s default augmentation no longer reaches the right interface. The local augmentation works around it until css-interop ships a fix.
- `apps/web/tsconfig.json` — added `paths` entry for `@nodescope/shared` pointing at TS source (matching the api jest configs); added `nativewind-env.d.ts` to `include`.
- Four `setUser(result.data.user as SessionUser)` cast sites — now cast through `unknown` (`as unknown as SessionUser`). Better Auth's client doesn't propagate server-side `additionalFields` (`tier`, `homeLatitude`, `homeLongitude`) into its inferred session type. Functional but loses type safety on those three fields — proper fix is to configure the client with matching `additionalFields`, deferred.
- `apps/web/components/map/MapView.tsx` — `StyleSheet.absoluteFillObject` → `StyleSheet.absoluteFill` (RN 0.85 dropped `absoluteFillObject` from the type definition; `absoluteFill` is the documented replacement).

#### Web bundler config + code splitting

- `apps/web/app.json` — `expo.web.output` is `"static"` (per-route pre-rendered HTML + a shared JS bundle). Was briefly switched to `"single"` while debugging the EXPO_ROUTER_APP_ROOT substitution, then restored once the hoisting fix landed. `"static"` is also what enables real code splitting via dynamic `import()`.
- `apps/web/app/(app)/_layout.tsx` — `import { Ionicons } from '@expo/vector-icons'` replaced with `import Ionicons from '@expo/vector-icons/Ionicons'`. The barrel import was pulling in MaterialIcons, FontAwesome, and ~10 other unused icon families; the targeted import shaved 514 KB raw / ~135 KB gzipped.
- `apps/web/app/(app)/map.tsx` + `apps/web/components/map/MapView.tsx` — MapView is now lazy-loaded via `React.lazy(() => import(...))` behind a `<Suspense fallback>`. Metro emits a separate `MapView-*.js` chunk that downloads only when the map screen renders. `MapView.tsx` got a `export default MapView` so React.lazy can consume it.
- `experiments.asyncRoutes.web` was tested and found to have no effect on production export (Expo CLI bundles statically regardless of the flag), so it is **not** retained in `app.json`. React.lazy is the only mechanism that triggers Metro to emit a separate chunk in production builds.

### Verification

- `npm audit`: **26 → 4 moderate** (no high, no critical, no low). All 4 are dev-time `postcss` transitive via `@expo/cli` / `@expo/metro-config` — not in the production browser bundle.
- API: `nest build` clean; 118/118 unit tests pass (13 suites); 17/17 graceful-degradation e2e tests pass (3 suites).
- TypeScript: `tsc --noEmit` clean on both `apps/web` and `apps/api`.
- Web bundle: `entry-*.js` **1.44 MB raw / 413 KB gzipped** (initial paint) + `MapView-*.js` **793 KB raw / 209 KB gzipped** (lazy on map route). Initial-paint chunk is **under the CLAUDE.md <500 KB gzipped target**. (The first measurement after the perf commit was 405 KB; +8 KB came from adding the `inferAdditionalFields` plugin to drop the unknown casts — see "Follow-ups landed" below.)

### Not verified — needs in-browser smoke test

This upgrade changed UI rendering behavior in non-trivial ways (React 19 transitions, NativeWind augmentation path). The dev server has not been started against a real browser. Before declaring this phase done, walk through:

1. `npm run dev --workspace=apps/web` boots without runtime errors.
2. Login → map → device CRUD → AI chat → settings paths all render and behave.
3. Class-based styling (NativeWind `className`) actually applies at runtime (not just typechecks).
4. MapView Suspense fallback briefly shows on first map load, then the map renders (cached on subsequent visits).

### Open follow-ups

- `react-native-css-interop` augmentation upstream: when the maintainer ships a fix for RN 0.85's restructured types, the manual `nativewind-env.d.ts` augmentations can be deleted.
- `npm audit fix --force` on the 4 remaining moderate `postcss` advisories — these resolve only when Expo/RN ship updated CLI dependencies; nothing to do locally.

### Follow-ups landed (since this section was first written)

- **Better Auth client `additionalFields`** — `apps/web/lib/auth-client.ts` now configures `inferAdditionalFields({ user: { tier, homeLatitude, homeLongitude } })` (all three with `input: false` mirroring the server). The four `as unknown as SessionUser` casts in `app/_layout.tsx`, `app/(app)/_layout.tsx`, `app/(auth)/login.tsx`, and `app/(auth)/register.tsx` are now plain `as SessionUser`. `SessionUser.createdAt/updatedAt` retyped `string` → `Date` to match Better Auth's client deserialization. Entry chunk grew ~8 KB gzipped from the new plugin (405 → 413 KB, still under target).

---

## Phase 9c — Deployment Hardening 🟢

**Implemented:** 2026-05-16

### What was built

#### `.do/app.yaml` — DigitalOcean App Platform spec

Codifies the App Platform deployment. Created once with `doctl apps create --spec .do/app.yaml`; subsequent pushes to `master` auto-deploy with the spec from the new commit (no console clicks required to change platform config).

- **api service** — NestJS, 2 × `basic-xxs`, healthcheck on `/api/health`. Build runs `npm ci --legacy-peer-deps`, `prisma generate`, `nest build`. Plain env vars baked into the spec; secrets (`DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `ANTHROPIC_API_KEY`) declared with `type: SECRET, value: ""` so the spec round-trips without leaking them.
- **web static_site** — Expo Web export, `catchall_document: index.html` so unknown paths fall through to the SPA shell for expo-router to handle client-side.
- **Host-based ingress** — top-level `ingress.rules` block (the per-component `routes:` form is deprecated) pins each domain to exactly one component via `match.authority.exact`:
  - `api.nodescope.io/*` → api service (`preserve_path_prefix: true` so NestJS's `setGlobalPrefix('api')` still sees the `/api` prefix)
  - `app.nodescope.io/*` → web static site
  - API is **unreachable** from `app.nodescope.io`, matching the CORS posture in `main.ts` (only `FRONTEND_URL` is allowed as origin).

#### `scripts/smoke.mjs` + `deploy.yml` integration

Post-deploy smoke test runs as a new `smoke` job sequenced after `deploy`. App Platform's own healthcheck only hits `/api/health`; a 200 there does not catch broken auth, broken CORS, broken WebSocket transport, or the web SPA failing to serve. The smoke script exercises six paths:

1. `GET /api/health` → 200 with `status=ok|degraded` (retried 6 × 5s for cold-start grace)
2. `GET /api/auth/get-session` → 200 with empty session (Better Auth reachable)
3. `OPTIONS /api/v1/devices` → CORS preflight echoes `Origin` and sets `Access-Control-Allow-Credentials: true`
4. `GET /socket.io/?EIO=4&transport=polling` → handshake returns `sid`
5. `GET /` (web) → 200 with `<html>` containing "NodeScope"
6. `GET /__catchall_smoke` (web) → 200, SPA catchall returns the index shell

Self-contained (only native `fetch`, no external deps), arg- or env-driven, exits 0 on all-pass / 1 on any failure. Smoke failure fails the workflow run so the broken deploy is visible in commit status.

URLs are hardcoded in both `.do/app.yaml` and `deploy.yml`; the workflow header notes the two files must be updated together when domains change.

#### `apps/web/app.json` — drop dangling favicon reference

`./assets/favicon.png` never existed; the build was warning on every web export. Removed the reference for now; add back when a real favicon asset exists at that path.

### Architecture notes

- `routes:` on components is deprecated in App Platform; `ingress.rules` is the modern shape. Mixing them is allowed but discouraged — components in this spec have no `routes:` and rely entirely on the top-level `ingress` block.
- `preserve_path_prefix` lives under `ingress.rules[].component`, not under `match.path`. Without it, App Platform trims the matched prefix from the upstream request, which would break NestJS's `setGlobalPrefix('api')` (the API would only see `/health` instead of `/api/health`).

---

## Phase 9d — Schema-drift Fixes + Dead-code Sweep 🟢

**Implemented:** 2026-05-16

### What was built

#### `feat(db): add MULTI_PROPERTY to AccountTier enum` (commit `37e202e`)

The original 4-tier design (FREE → PAID → MULTI_PROPERTY → ENTERPRISE) was documented in CLAUDE.md and reflected in `TierGuard.TIER_ORDER` (MULTI_PROPERTY at position 2), but Prisma's enum had only 3 values — code intent and DB schema were drifted. New migration `20260516010000_add_multi_property_tier`:

```sql
ALTER TYPE "AccountTier" ADD VALUE 'MULTI_PROPERTY' BEFORE 'ENTERPRISE';
```

Verified against a throwaway PostgreSQL 16 + TimescaleDB-HA container: MULTI_PROPERTY lands at `pg_enum.enumsortorder = 2.5`, between PERSONAL_PAID (2) and ENTERPRISE (3). Purely additive — no existing rows referenced MULTI_PROPERTY (it was never assignable), so the migration is non-breaking. TierGuard's ordering, TiersService's device-limit logic, and Better Auth's `tier: string` field require no code changes.

#### `refactor(shared): dedupe Prisma enums via type-only re-export` (commit `2e2fd4b`)

CLAUDE.md Rule #6: "No hand-written types that duplicate Prisma-generated types." Three hand-written union types in `packages/shared` duplicated Prisma enums:
- `AccountTier` (had silently drifted from Prisma — included MULTI_PROPERTY, Prisma didn't, until 9d's earlier commit)
- `ConnectionType`
- `DeviceCategory`

All three now re-exported type-only from `@prisma/client`:

```ts
// packages/shared/src/types/api.types.ts
import type { AccountTier, ConnectionType } from '@prisma/client';
export type { AccountTier, ConnectionType };
```

The separate `import type` is needed because `export type { X } from 'pkg'` re-exports without bringing X into local scope — `UserDto.tier` and `DeviceConnectionDto.connectionType` reference them as values internally.

Bundle impact: **zero**. Type-only imports erase at compile time; Metro tree-shakes the empty import. Verified web bundle still at ~412 KB gzipped entry chunk (vs 413 KB pre-dedupe; within build-hash noise), zero "prisma" / "PrismaClient" strings in the bundle output.

`DEVICE_CATEGORY_CONFIG` (zoom-level metadata map) stays in shared — it's map-rendering config, not Prisma-derived.

#### `chore(shared): remove dead exports` (commit `1991a5f`)

Four types in `packages/shared` had zero consumers anywhere in the codebase (no imports, no inline shape duplicates that should have been refactored to use them). Per CLAUDE.md "don't design for hypothetical future requirements" — dropped:

- `MetricRowDto` — duplicated Prisma's `DeviceMetric`, which is what `data-sources.repository.ts` actually returns.
- `SourceType` — only used internally by `MetricRowDto`. `realtime.store` / `realtime.gateway` type `sourceTypes` as plain `string[]`.
- `WsErrorPayload` — never typed against. WS error events constructed inline at emit sites.
- `ConnectionStatusPayload` — same.

`packages/shared/src/types/metrics.types.ts` became empty after the deletes and was removed entirely; `index.ts` no longer barrels it.

**Kept (deliberate):**
- `ApiError` — canonical error envelope from API Design §2, symmetric with `ApiSuccess<T>` (which IS used). Deleting one would leave the success/error pair asymmetric.
- `AuthenticatedUser = SessionUser` alias — two names serve two contexts (`@CurrentUser() user: AuthenticatedUser` reads well in controllers; `SessionUser | null` reads well in `auth.store`). 1-line alias, no harm.

### Verification

- `tsc --noEmit` clean on both `apps/web` and `apps/api`.
- 118/118 unit tests + 17/17 graceful-degradation e2e tests pass.
- Web bundle: entry-chunk 412 KB gzipped (within target), MapView lazy chunk 214 KB. Zero Prisma runtime strings in the web bundle.
- `npm audit` unchanged at 4 moderate (all in `@expo/cli` postcss transitive chain — upstream-blocked).

### Architecture notes

- The MULTI_PROPERTY migration was verified via a throwaway container on port 5436 because the host machine has a native PostgreSQL on 5432 shadowing the Docker port mapping. `docker-compose.yml`'s dev DB (port 5432) is unreachable from the host until either the native Postgres is stopped or `docker-compose.yml` is remapped to a different port.
- The dedupe sweep means `packages/shared` no longer needs to manually mirror Prisma enum additions. New Prisma enum members propagate to shared via the type-only re-export automatically.

---

## Phase 9e — First-run Shakedown 🟢

**Implemented:** 2026-05-18

Phase 9b's dependency upgrade (Expo 51 → 55, RN 0.74 → 0.85, React 18 → 19, RN-Web 0.19 → 0.21) was code-complete with the web bundle under target, but it had never been exercised in a running browser. The first dev-server run produced one outright crash, one fully-broken screen, two console-noise sources, one latent DB bug that would have killed any environment that successfully booted the API, plus a handful of supporting cleanups. This phase captures the full shakedown.

### `fix(web): restore map rendering broken by Expo 55 / RN-Web 0.21 upgrade` (commit `19a1b08`)

The map screen rendered the MapLibre attribution and the bottom-left zoom-label widget but no map tiles. Two stacked regressions, both produced by the same dependency bump:

**Layer 1 — NativeWind CSS wasn't being processed.** `apps/web/metro.config.js` did not wrap with `withNativeWind`. In Expo 51 the default Metro config evidently picked up Tailwind processing implicitly; in Expo 55 it does not. As a result `@tailwind base/components/utilities` shipped to the browser unprocessed — the production CSS file was literally 56 bytes — and every `className="flex-1"` rendered as `<div class="flex-1">` with no matching CSS rule. The flex chain that fed the map container its height collapsed to zero.

Fix: wrap with `withNativeWind(config, { input: './global.css' })`. This pulled in `react-native-css-interop` (NativeWind 4's engine), which calls `require("react-native/package.json")` at metro-config load. Without `react-native` hoisted to the workspace root, the require failed. Added `react-native: 0.85.3` to root `devDependencies` as a hoist hint, following the existing pattern used for `expo-router` and `react-native-worklets`.

**Layer 2 — `StyleSheet.absoluteFill` lost a CSS specificity tie to MapLibre's stylesheet.** Even with the flex chain restored, the map container would have stayed at 44 px tall. RN-Web 0.21 compiles `StyleSheet.absoluteFill` to hashed class rules (`.r-position-…{position:absolute}`) instead of inline styles. MapLibre's runtime-injected `.maplibregl-map { position: relative }` rule loads later in source order and wins the (0,1,0) vs (0,1,0) specificity tiebreak — overriding `position:absolute`, neutralising the `top/right/bottom/left:0` insets, and collapsing the element to its intrinsic content height (the canvas, which MapLibre had auto-sized to 44 px at init time before re-measure could fire).

Fix: changed both `MapView` root and the inner map container from `StyleSheet.absoluteFill` to `flex: 1`. Flex sizing doesn't depend on the `position` property, so MapLibre's CSS can't override it. Left an inline comment in `MapView.tsx` explaining the trap so a future "simplify back to absoluteFill" cleanup doesn't reintroduce the bug.

Bundle impact: entry-chunk **412 KB → 416 KB gzipped** (within target).

### `fix(db): composite PK on DeviceMetric for TimescaleDB compatibility` (commit `f83ec4b`)

TimescaleDB rejects unique constraints on hypertables that don't include the partitioning column. The init migration created `DeviceMetric.id` as a single-column primary key, so when `TimescaleService.initializeHypertable()` ran `SELECT create_hypertable(...)` at boot it failed with `cannot create a unique index without the column 'time'` and `process.exit(1)`'d. The API never successfully started in any environment that had real DB infrastructure — the only reason this hadn't been caught earlier was that prior dev sessions ran against an empty / non-Timescale Postgres.

New migration `20260517210000_devicemetric_composite_pk`:

```sql
ALTER TABLE "DeviceMetric" DROP CONSTRAINT "DeviceMetric_pkey";
ALTER TABLE "DeviceMetric" ADD CONSTRAINT "DeviceMetric_pkey" PRIMARY KEY ("id", "time");
```

Schema change: `id String @default(uuid())` (no `@id`) + `@@id([id, time])`. Additive — no rows existed because the hypertable was never successfully created.

### `chore(api): make dev iteration usable — relaxed throttles + monorepo .env + pino-pretty` (commit `1b8ea1b`)

Three dev-only quality-of-life fixes bundled together:

- `ConfigModule.forRoot` now reads `['.env', '../../.env']` so the monorepo's root `.env` is discovered without each workspace duplicating it.
- Throttler default scales from 100/min (prod) to 2000/min (dev), and auth from 5/15min to 200/15min. Strict prod limits broke the dev loop because Better Auth's `get-session` shares the same controller as sign-up/sign-in — every page load called it, and after a few refreshes new sign-ins started 429ing. There's a TODO in `auth.controller.ts` noting the proper fix (per-endpoint throttling with `@SkipThrottle` on benign reads), but the env-scaled limits cover the gap until then.
- `pino-pretty` added as a dev dependency so the existing dev transport in `app.module.ts` has something to render with.

### `chore: tsconfig cleanup` (commit `fe71fd2`)

`apps/api/tsconfig.json`: dropped the unused `@nodescope/shared` path alias (imports resolve via the workspace symlink) and dropped `prisma/seed.ts` from `include` (the seed runs via `ts-node` with its own config).

`apps/web/tsconfig.json`: added `.expo/types/**/*.ts` so Expo's generated route types are picked up by the editor.

### `fix(web): give RHF explicit defaultValues on login/register` (commit `eaea88e`)

Without `defaultValues`, React Hook Form treats the inputs as uncontrolled on first render and warns. On RN-Web 0.21 the inputs could flicker between empty and current value during submit-state changes. Initializing each field to its empty value silences the warning and stabilizes the input lifecycle. Two-line change per form.

### `chore(web): track expo-cli-managed .gitignore` (commit `329cfe5`)

Expo CLI auto-generates `apps/web/.gitignore` on first run to exclude `expo-env.d.ts` (which Expo regenerates on every start). Committing it so the next developer's working tree doesn't immediately diverge.

### `feat(api): /api/bandwidth/echo for browser-collector measurements` (commit `b981929`)

The browser collector measures download (GET) + upload (POST) bandwidth every 30 s. It was previously hitting `/api/health` for both, but `HealthController` only declared `@Get()`, so the POST 404'd on every collection cycle — flooding the dev console *and* turning the upload bandwidth value on `/clients` into a measurement of "how fast does the API return 404". The `docs/API_Design.md` description of `/api/health` even claimed it accepted POST for bandwidth measurement — that intent was never implemented.

New `BandwidthModule` owns this concern so `HealthController` stays single-purpose. `GET /api/bandwidth/echo` returns 1 MB of `crypto.randomBytes` as `application/octet-stream`. Random (not zeros) so any future compression middleware can't silently shrink the payload on the wire and turn bandwidth into latency. Octet-stream is already skipped by the current `compression` middleware's default filter, so the measurement is meaningful as-is. `POST /api/bandwidth/echo` drains the request body via async iteration before responding with 204 — without explicit draining, body-parser doesn't touch `application/octet-stream` and the 204 goes out before the upload finishes; the browser's measured upload time would be TCP RTT, not transfer.

Browser-collector also switched from `response.text().length` to `response.arrayBuffer().byteLength` so the downloaded byte count is the actual byte size (text decoding can collapse multi-byte sequences in binary data).

E2E test: 8 cases covering payload size, headers, body draining, empty-body POST. Boots `BandwidthModule` in isolation (no DB/Redis dependency).

### `chore(web): silence RN-Web 0.21 props.pointerEvents deprecation` (commit `4fe8533`)

RN-Web 0.21 deprecated the prop form `<View pointerEvents="...">` and asks for `style={{ pointerEvents: "..." }}` instead. `@react-navigation/bottom-tabs@7.16.1` and `@react-navigation/elements@2.9.18` (both the latest releases — nothing newer on npm) still use the prop form in 6 spots across 4 files, firing the warning on every navigator render.

Patched via `patch-package` (wired as a root `postinstall` script). The patches edit both `src/*.tsx` source files and the compiled `lib/module/*.js` so the fix survives Metro's resolution regardless of which entry it picks. Files patched: `BottomTabBar`, `BottomTabView`, `ResourceSavingView`, `Screen`. Patches stop applying the moment react-navigation publishes a version that addresses the deprecation upstream — at which point they should be deleted and the deps bumped.

### `chore(web): add placeholder favicon to stop browser /favicon.ico 404s` (commit `3cf44e2`)

App had no `web.favicon` in `app.json` (it was removed in commit `9384f59` when the asset didn't exist yet), so the generated HTML shipped without a `<link rel="icon">` and browsers fell back to auto-requesting `/favicon.ico` from the root — which 404'd on every cold load. Added a 32×32 solid-gray placeholder PNG (154 bytes) at `apps/web/assets/favicon.png` and re-introduced the reference. Generic gray is intentional — should be swapped for real branding when NodeScope has any.

### `fix(api): wrap /v1/clients response in standard success envelope` (commit `125f7c4`)

Clicking the Clients tab crashed with `can't access property "currentDevice", data is undefined` at `apps/web/app/(app)/clients.tsx:73`. `ClientsController` was returning the service result directly while every other controller (users, map, devices, ai, etc.) wraps responses in `{ success: true, data, timestamp }` per API Design §2. The frontend reads `res.data.data` expecting the envelope; without it, `data` was undefined but the screen state still flipped to `'loaded'`, and the next render hit a non-null-asserted access.

The existing e2e test (`clients.controller.e2e.ts`) already asserted the envelope shape — this was a textbook red-state bug where the test was written correctly but the implementation never matched. The test never caught the regression because the e2e suite requires live DB/Redis and isn't part of the default dev loop.

Phase 7 ships marked as "complete" but evidently `/clients` was never actually clicked in a running web app — worth keeping in mind that other screens (Equipment, Circuits, AI Assistant, Settings) haven't been exercised either in this session.

### Verification

- Map renders correctly at `localhost:8081/map` — tiles load, attribution at bottom-right, navigation control top-right, zoom-label overlay bottom-left.
- `POST /api/health` 404s no longer fire in the dev console; the browser collector now hits `/api/bandwidth/echo` and gets 200 + 204 as expected.
- `props.pointerEvents is deprecated` warning gone after restarting the dev server with `--clear`.
- `/favicon.ico` 404 gone — browser now requests the hashed favicon asset from `_expo/static/`.
- Clients tab renders cleanly — the "This Device" card populates with user-agent, platform, and (after ~30 s) live bandwidth/latency metrics from the collector.
- Web entry chunk: **416 KB gzipped** (vs 412 KB pre-session). Within 500 KB target.
- Bandwidth e2e: 8/8 passing.
- Working tree clean after each commit; all commits pushed to `origin/master`.

### Architecture notes

- The RN-Web 0.21 compilation behavior change (inline-style → hashed-class) is the load-bearing detail behind both the map bug and the pointerEvents deprecation. Any future RN-Web bump worth scrutinising for similar regressions wherever the codebase or its dependencies rely on inline-style specificity.
- `patch-package` is now part of the toolchain. Patches under `patches/` re-apply on every `npm install` via the root `postinstall` script. When react-navigation ships a release that addresses the pointerEvents deprecation upstream, the patches will fail to apply against the new file contents and patch-package will warn loudly — that's the cue to delete the `.patch` files and bump the deps.
- This phase did *not* exercise Equipment, Circuits, AI Assistant, or Settings screens. They may carry similar latent bugs to the `/clients` envelope issue, and would be worth a deliberate sweep before declaring the app "user-ready".

---

## MVP Complete (code-side)

All Phase 0–9e code is in the repo. Phase 9b dependency upgrade landed code-side with the web bundle under the <500 KB gzipped target. Phase 9c codified the App Platform deployment and added a post-deploy smoke test that runs as part of `deploy.yml`. Phase 9d cleaned up the drift between code intent (TierGuard, CLAUDE.md) and schema reality (Prisma) and deduped hand-written types that violated Rule #6. Phase 9e — the first-run shakedown — caught the dependency-upgrade regressions, the latent DeviceMetric/TimescaleDB bug, and the `/clients` envelope crash that would have been the first thing any new user hit.

Remaining work is operational: cloud provisioning (managed PG with PostGIS + TimescaleDB, managed Redis, App Platform app from `.do/app.yaml`), secret configuration, first production deploy (which will exercise the smoke test for the first time), manual cross-browser verification, and a deliberate sweep of the four screens that 9e didn't touch (Equipment, Circuits, AI Assistant, Settings).

---

## Phase 10 — Post-MVP iteration (2026-05-18/19)

Three threads of work in one session: a drag-handling bug discovered during normal use, then two planned features (buildings toggle + cross-device preference sync). The drag bug was found incidentally, diagnosed and fixed first; the two features went through a full brainstorm → spec → plan → implement → review cycle.

Specs and plans (local only — `docs/` is gitignored):
- `docs/superpowers/specs/2026-05-19-buildings-toggle-design.md`
- `docs/superpowers/plans/2026-05-19-buildings-toggle.md`
- `docs/superpowers/specs/2026-05-19-map-preferences-sync-design.md`
- `docs/superpowers/plans/2026-05-19-map-preferences-sync.md`

### `fix(web): map drag broken after tab switch (invalid 'box-none' CSS)` (commit `6d560ce`)

User-reported: drag the map → switch to another tab → switch back → drag no longer works. Diagnosed end-to-end via a Playwright reproduction that confirmed `pointer-events: none` was bleeding down to the MapLibre canvas-container after the tab cycle.

Root cause: the `patch-package` patch from Phase 9e (`@react-navigation/bottom-tabs+7.16.1.patch`, commit `4fe8533`) wrote `pointerEvents: 'box-none'` as an inline style on `MaybeScreen` in `BottomTabView.tsx`. The CSS value `box-none` is a React Native concept, not a valid CSS pointer-events value. Browsers silently reject it. The interaction:

- First render (focused): tries inline `pointer-events: box-none` → rejected → no inline value → inherits `auto`. Drag works.
- Tab away (unfocused): inline becomes `pointer-events: none`. Accepted.
- Tab back (focused): tries to update inline back to `box-none` → rejected → **stale `none` stays in the inline style**. Inherits down through the screen wrapper to MapLibre's `.maplibregl-canvas-container` and silently kills drag.

Fix: change `'box-none'` to `'auto'` in the patch. On web the two are functionally equivalent for the focused case (children still receive events either way), and `'auto'` is valid CSS so it correctly replaces the stale `'none'` on update. One-character semantic change.

Verified with Playwright: drag works, switch tabs, switch back, drag still works.

### `feat(web): show OpenFreeMap building footprints` + toggle in MapControls (commits `3f5e97d`, `db64de6`)

The OpenFreeMap "liberty" style **already includes** a `building` fill layer (minzoom 13) sourced from the `openmaptiles` vector tiles — but its default `fill-color: hsl(35,8%,85%)` against the basemap is effectively invisible. Phase 10's first feature: make them visible and gate behind a user toggle.

Two commits, both frontend-only:

1. `3f5e97d` — store + map wiring. Add `buildingsVisible: boolean` to `ui.store` (persisted to localStorage as `ns:buildingsVisible`, default `true`). Two `useEffect` hooks in `MapView.tsx`: one runs `setPaintProperty` once on map-ready to override the too-pale defaults with `hsl(35,12%,78%)` fill + `hsl(35,15%,55%)` outline; the other toggles `visibility` whenever the store flag flips.
2. `db64de6` — UI. Add a new "Base Map" group at the top of the expanded MapControls panel with one row ("Buildings") using the same checkbox + label pattern as the device-category toggles, including the `z13+` faded indicator below the building layer's minzoom.

The defensive `if (!map.getLayer('building')) return` guard in both effects covers the case where OpenFreeMap renames the layer upstream.

### `feat: cross-device map preferences sync` (commits `55f1e89` → `cf295ce`, 10 commits)

User asked for cross-device sync of map preferences (initially just buildingsVisible; expanded during brainstorm to all six "my view" fields). Local-first architecture by explicit user requirement — the app must remain fully functional with internet down at the location.

Six fields synced: `buildingsVisible`, `layerToggles`, `mapCenter`, `mapZoom`, `selectedFloor`, `floorDisplayMode`. Two of those (`selectedFloor`, `floorDisplayMode`) were transient before this work — they now persist to localStorage AND server.

**Storage:** New `User.mapPreferences Json @default("{}")` column. Single ALTER TABLE migration, NOT NULL default `{}` covers existing rows with no backfill.

**API:** Two endpoints under `/api/v1/users/me/preferences`:
- `GET` returns `{ preferences: MapPreferences }`, empty `{}` for fresh users.
- `PUT` validates via class-validator and replaces entirely (not merges). Returns the actually-stored value, not the request DTO (caught in code review — Postgres jsonb can normalize keys, so echoing the DTO would diverge from reality).

Bypasses Better Auth's `input: false` lockdown by following the existing `setLocation` pattern (custom endpoint that writes via the repository, not via Better Auth's `updateUser`).

**Frontend — local-first model:**
- localStorage is the operational source of truth. All reads come from localStorage (instant, works offline). UI updates synchronously.
- A `mapPreferencesDirty: boolean` flag (also localStorage-backed) tracks unsynced changes.
- Every existing setter writes through to localStorage, sets `dirty=true`, then enqueues a 500 ms-debounced PUT.
- On bootstrap (after `authClient.getSession()` resolves), `syncPreferencesFromServer` runs a three-branch reconciliation:
  1. **Local-wins:** if `dirty=true`, PUT local state to server (preserves offline changes).
  2. **One-shot migration:** if server is empty `{}` AND any Phase-1 localStorage keys exist, PUT the local state once.
  3. **Server-wins:** for each field the server has set, write to localStorage + store. Fields the server hasn't set keep their current value (defaults).
- On WebSocket `reconnect`, `flushMapPreferences` PUTs current state if dirty. (See "Outstanding items" below — this is structurally wired but the underlying `reconnect` event never fires.)
- All API calls wrapped in try/catch — failures leave dirty=true and are non-fatal.

**Test coverage (backend, TDD):**
- `users.repository.spec.ts` — 6 integration tests against the real test DB for `getPreferences` / `updatePreferences`.
- `users.controller.e2e.ts` — 8 e2e tests covering round-trip, replace semantics, validation (400 for bad shapes / unknown extra fields), auth (401).

**Frontend verification:** No frontend unit-test suite per project convention. Verified with a 4-scenario Playwright script: online happy path (debounce coalescing rapid changes into one PUT), offline tolerance (UI works offline, dirty flag persists), Phase-1 → Phase-2 migration (localStorage keys auto-pushed once), cross-device hydration (fresh browser pulls server state).

### Side fixes that landed during Phase 10

- `0d70963` — `chore(api): add mapPreferences to test User fixtures`. Required follow-up after the schema migration made `mapPreferences` a required field on the Prisma-generated `User` type — `users.service.spec.ts` had a `mockUser` literal missing the field that no longer compiled.
- `96d0426` — `fix(api): code-review followups on /v1/users/me/preferences`. Three small fixes from the code-quality reviewer: PUT now returns the stored value (not the request DTO) so the response can't diverge from DB; deduplicated `MOCK_SESSION_TOKEN` import (was triplicated across `__mocks__/better-auth-node.ts`, `__mocks__/better-auth.ts`, and the e2e test); aligned mock-user email with the e2e-seeded DB row.
- `55f3896` + `cf295ce` — health controller `package.json` path. The Phase 8 commit `9043510` introduced `readFileSync(join(__dirname, '../../package.json'))` for the dynamic version, but the path is layout-sensitive: `__dirname` is `apps/api/src/health/` under ts-jest and `apps/api/dist/src/health/` under compiled dev/production. Two `../` works in source layout; three `../` works in compiled. Final fix (`cf295ce`) tries both and uses whichever `readFileSync` succeeds — bulletproof against build/transpile layout choices. The original `55f3896` (three-dot-only) was reverted-by-superseding; the path landed correct for compiled but broke ts-jest, blocking the entire e2e suite from loading.
- Auth e2e mocks (`__mocks__/better-auth-node.ts`, `__mocks__/better-auth.ts`) were extensively rewritten as part of `c0035a9`. The pre-Phase-10 stubs returned `undefined` for `toNodeHandler` and hardcoded `null` for `getSession`, meaning every e2e test that touched auth blew up at runtime or got an unconditional 401. The new mocks simulate a real session flow (signup issues a cookie, get-session honors it). This unblocked the new Phase 10 e2e tests AND fixed several pre-existing tests that had been silently red — but did not fix every e2e suite (see "Outstanding items" below).

### Outstanding items (queued for a follow-up session)

**[Medium] `websocketService.on('reconnect', ...)` is dead code app-wide.** In `socket.io-client` v4, the `reconnect` event lives on the `Manager`, not the `Socket`. The handler in `apps/web/app/(app)/_layout.tsx` that calls `flushDevices`, `flushCircuits`, and (new) `flushMapPreferences` on reconnect never fires. Pre-existing — affects all three flush handlers. Fix: subscribe to `socket.on('connect')` with a `wasConnected` boolean to distinguish reconnect from initial connect, then emit a custom event or call the flushes directly. Until fixed, dirty data flushes on the next user action, not automatically on reconnect.

**[Low] `UsersService` unit-test gap.** `getPreferences` and `updatePreferences` are not covered in `users.service.spec.ts`. The mock repository shape in that file doesn't declare them. E2E covers the integration, so Rule #1 is technically violated but practically OK.

**[Low] 4-site update requirement for new preference fields.** Adding a Phase 11 preference field requires coordinated updates to `MapPreferences` (shared type), `UpdatePreferencesDto` (class-validator), `collectCurrentPreferences` (frontend), and the server-wins `if` block in `syncPreferencesFromServer`. No compile-time enforcement.

**[Low] `layerToggles` value types not validated at runtime.** `@IsObject()` on the DTO accepts `{ ROUTER: 'yes' }` (string instead of boolean). In practice only the frontend writes this, but no defense-in-depth at the API boundary.

## Phase 11 — e2e suite green-line + Better Auth tests via real flow (2026-05-20)

Closes the [High] outstanding item from Phase 10. Goal: `npm test --workspace=apps/api` exits 0.

**Test mode migrated to ESM, production stays CJS.** Better Auth ships ESM-only (`"type": "module"`, no `.mjs` CommonJS entry); Jest's CJS test runner couldn't load it, which is why the original session shipped with hand-written mocks under `apps/api/__mocks__/better-auth*.ts`. Those mocks accumulated drift — they never persisted users to the DB, lost dynamic signup emails, didn't track sign-out, and missed endpoints (`/forget-password`). The fix is a hybrid: production keeps `module: commonjs`; tests use a new `apps/api/tsconfig.jest.json` with `module: ESNext` + `moduleResolution: Bundler`, ts-jest in `useESM` mode, and jest invoked with `NODE_OPTIONS='--experimental-vm-modules --no-warnings'` (via `cross-env` in `package.json` scripts so Windows works). The three `__mocks__/better-auth*` files were deleted.

**Six bugs surfaced and fixed once the real Better Auth was wired in:**

1. **`AiController` was mounted at `/api/ai/*` instead of `/api/v1/ai/*`** — `@Controller('ai')` should have been `@Controller('v1/ai')`. The web app (axios baseURL `/api/v1`) was hitting `/api/v1/ai/*` and getting 404 in production; nothing flagged it because the AI feature was never exercised end-to-end on the deployed instance. Same commit also added `@HttpCode(HttpStatus.OK)` on `@Post('message')` so the response code matches the documented contract instead of NestJS's default 201.

2. **Better Auth's password-reset endpoint is `/api/auth/request-password-reset`, not `/api/auth/forget-password`.** The CLAUDE.md reference was wrong. Also added a no-op `sendResetPassword: async () => undefined` in `better-auth.config.ts` so the endpoint returns 200 in MVP (where no email service is configured) — this preserves the anti-enumeration contract.

3. **Optimistic-concurrency PATCH DTOs rejected every changeset** because `ChangesetChangeDto.oldValue` and `.newValue` were declared with no class-validator decorator. With `forbidNonWhitelisted: true`, the validator stripped them and the resulting empty changes array failed `@ArrayMinSize(1)`. Added `@Allow()` on both fields in `devices`, `circuits`, `connections`, and `fiber-runs` DTOs.

4. **`MapRepository.findDevicesInBbox` failed with `Failed to deserialize column of type 'geometry'`.** The raw query used `SELECT d.*`, which returned the untracked `location geometry(Point, 4326)` column that Prisma can't parse. Switched to `$queryRawUnsafe` with explicit column list. This was a real production bug masked by the auth/FK failures upstream — anyone with devices on the map would have hit it.

5. **`HealthController`'s `API_VERSION` IIFE used `__dirname`** (CJS-only). In ESM tests it threw ReferenceError. Refactored to try `__dirname` and fall back to `process.cwd()` candidates. Also tightened the candidate-version loop to skip entries whose package.json has no `version` field (the repo-root workspace `package.json` doesn't).

6. **`DataSourcesRepository` integration test was flake-prone** because `createMany` evaluates `@default(now())` once per statement, so two rows landed with identical timestamps and the `ORDER BY time DESC` was non-deterministic. Test now passes explicit `time` values.

**Test files rewritten:**
- `users.controller.e2e.ts` and `clients.controller.e2e.ts` — dropped the deleted-mock imports and the dead `dev@nodescope.test` sign-in; both sign up a fresh real user per suite and clean up via `prisma.user.deleteMany` (cascades through all owned entities).
- `realtime.gateway.e2e.ts` and `__tests__/graceful-degradation/websocket-reconnect.e2e.ts` — replaced `jest.mock('../../auth/better-auth.config', …)` with `jest.spyOn(auth.api, 'getSession').mockResolvedValue(…)`, since `jest.mock` doesn't hoist in ESM. The realtime gateway test also expanded `mockRedis.duplicate()` to return a noop pub/sub client (`on/subscribe/psubscribe/…`) because the real `@socket.io/redis-adapter` runs in ESM mode instead of being mock-replaced.
- `devices/circuits/connections/fiber-runs/map/ai` e2e files — added `name` field to sign-up payloads (Better Auth's `signUpEmail` requires it), tracked `testEmail` in a const, and added `prisma.user.deleteMany` cleanup in `afterAll`.

**Globals injection.** `apps/api/jest.e2e.setup.ts` (also referenced from `jest.unit.config.ts` and `jest.integration.config.ts`) does `Object.assign(globalThis, await import('@jest/globals'))` so test files can keep using `jest.fn()` / `describe` / etc. without per-file imports. Jest's automatic `injectGlobals` doesn't work in ESM mode. The setup file also forces `DATABASE_URL=postgresql://…:5433/nodescope_test` so the suite cannot accidentally hit the dev DB.

**Verification:** unit 13/13 (118 tests), integration 6/6 (39 tests), e2e 14/14 (101 tests). `nest build` clean; `node dist/main.js` boots (EADDRINUSE means it tried to bind, i.e. CJS production runtime still works).

### Outstanding from Phase 11 (none blocking)

The earlier `websocketService.on('reconnect', ...)` dead-code item from Phase 10 is still open; it was diagnosed and documented but the fix is in `apps/web/lib/websocket.service.ts` and was not in scope for Phase 11.

## Phase 12 — `WebSocketService` Manager-event routing + first apps/web jest test (2026-05-20)

Closes the [Medium] outstanding item from Phase 10. In socket.io-client v4, `reconnect` and `reconnect_failed` are emitted on the Manager (`socket.io`), not the Socket — see `node_modules/socket.io-client/build/cjs/socket.js` `subEvents()`, which only relays `open`/`packet`/`error`/`close` to the Socket. The three pre-existing `this.socket.on('reconnect', …)` / `'reconnect_failed'` / consumer `websocketService.on('reconnect', …)` subscriptions in `apps/web/lib/websocket.service.ts` and `apps/web/app/(app)/_layout.tsx` were therefore dead code. `flushDevices()`, `flushCircuits()`, and (Phase 10's) `flushMapPreferences()` only ran on the next user action after reconnect, not automatically.

**Fix.** Inside `WebSocketService`:
- The two internal subscriptions now call `this.socket.io.on(...)` instead of `this.socket.on(...)`.
- The public `on()` / `off()` methods consult a small `MANAGER_EVENTS = {reconnect, reconnect_attempt, reconnect_error, reconnect_failed, ping}` set and route to `this.socket.io` for those, `this.socket` for everything else. Each branch is typed independently because socket.io's overloads don't reduce when accessed via a union variable.
- `_layout.tsx` is unchanged — `websocketService.on('reconnect', handleReconnect)` now does what its name promised.

**First jest test in apps/web.** Added `apps/web/lib/__tests__/websocket.service.spec.ts` with `apps/web/jest.config.ts`, `tsconfig.jest.json`, and `jest.setup.ts` mirroring the apps/api ESM pattern (ts-jest `useESM: true`, `--experimental-vm-modules` via `cross-env`, `Object.assign(globalThis, await import('@jest/globals'))` for jest globals). The test mocks `socket.io-client` with separate Socket and Manager `EventEmitter`s, mocks `ui.store` via `moduleNameMapper` (avoids pulling in Zustand/React), and uses `jest.unstable_mockModule` because plain `jest.mock` doesn't hoist in ESM. Five assertions: `'reconnect'` and `'reconnect_failed'` route to Manager, `'connect'` still routes to Socket, `off` symmetric.

Per CLAUDE.md ("No frontend unit-test suite per project convention") this opens a narrow door: pure-logic files under `lib/` and `store/` can have unit tests, but RN/JSX components continue to be verified through Playwright. The `testRegex` is scoped to `(lib|store)/__tests__/.*\\.spec\\.ts$` to keep that boundary explicit.

`apps/web/tsconfig.json` gained `exclude: ['**/__tests__/**', 'jest.config.ts', 'jest.setup.ts']` so the strict prod typecheck doesn't sweep up test fixtures with looser types.

**Verification:** `npm test --workspace=apps/web` → 5/5 passing. `npx tsc --noEmit` in `apps/web` → clean. The api test suite (`npm test --workspace=apps/api`) is still 258/258 (no API code touched).

## Phase 13 — Empty Login → Live Map + AI Onboarding Wizard (PR 1, 2026-05-21)

Closes the "empty map" complaint a fresh user sees on first sign-in: a `[0, 0]` zoom-2 globe with no devices, no network, and no obvious next step. Phase 13 introduces an AI-assisted onboarding wizard, persists the browser itself as a `Device` row of new category `BROWSER_CLIENT`, and adds a public-IP-match "On home network" pill on the map header. The data model is forward-compatible with Multi-Property tier (post-MVP Priority 2): `Network.userId` is indexed but not `@@unique`, and `Network.propertyId` is reserved as nullable.

Specs and plan (local only — `docs/` is gitignored):
- `~/.claude/plans/i-have-an-additional-eventual-rainbow.md` — the original PR 1 + PR 2 plan. Phase 13 is PR 1.

Shipped across **six slices on `feat/onboarding`** (sessions chosen so each commit is independently bisectable):

### Slice 1 — Networks module + onboarding state machine (commit `0778c40`, plus prep `6eebbb7` and the TimescaleDB fix `d408111`)

Schema additions in one Prisma migration (`20260521120000_add_networks_and_browser_device`):
- `Network` model — id, userId, name, homeAddress/homeLatitude/homeLongitude, homePublicIp, isp, downMbps, upMbps, version, propertyId (reserved). `@@index([userId])` and `@@index([userId, propertyId])`. Cascade-deletes on user removal.
- `Device.networkId String? @relation(...)` (nullable FK, `SetNull` on network delete), `Device.mobility DeviceMobility @default(UNKNOWN)`, `Device.browserDeviceId String?` with `@@unique([userId, browserDeviceId])` and `@@index([userId, networkId])`.
- `DeviceMetric.deviceId String?` (nullable; no FK because TimescaleDB hypertables can't have FKs to non-partitioned tables) and `DeviceMetric.tag String?` ('ambient' | 'speedtest', null treated as ambient). New `@@index([userId, deviceId, time])`.
- `DeviceCategory.BROWSER_CLIENT` and new `DeviceMobility` enum (HOME_ONLY | ROAMS | UNKNOWN).

**Backend modules added:**
- `apps/api/src/networks/` — full module per CLAUDE.md template. 5 endpoints under `/api/v1/networks` (list, create, get, patch, delete). One-network-per-user cap (`MAX_NETWORKS_PER_USER = 1`) enforced in service, not schema. `homePublicIp` returned by `GET /:id` only, never by `GET /` (list intentionally omits it). Optimistic concurrency via `version` column → `SYNC_001 EDIT_CONFLICT` on mismatch. `NETWORK_001 NETWORK_LIMIT_EXCEEDED` and `NETWORK_002 NETWORK_NOT_FOUND` are new error codes. 38 tests across repo/service/e2e.
- `apps/api/src/onboarding/onboarding.state-machine.ts` — pure function `step(progress, input) → { stepId, chips, fields, sideEffects[] }` over the 11 onboarding steps (`welcome → networkName → address → browserDeviceName → mobility → confirmHomeIp → routerMac → modemMac → isp → speeds → done`). Side-effect tags (`SaveNetwork`, `SaveBrowserDevice`, `SaveRouterDevice`, `SaveModemDevice`, `SaveHomeIp`) are typed so the service layer reading them is deterministic. 27 unit tests.

**Shared types:** new `packages/shared/src/types/network.types.ts` (`NetworkSummary`, `NetworkDetail`, `CreateNetworkDto`, `BrowserDeviceInfo`) and `onboarding.types.ts` (`OnboardingStepId`, `OnboardingFieldKind`, `OnboardingChip`, `OnboardingField`, `OnboardingProgress`, `OnboardingTurnRequest`, `OnboardingTurnResponse`). 3 new `WS_EVENTS` constants (`NETWORK_UPDATED`, `NETWORK_ON_HOME_CHANGED`, `ONBOARDING_TURN`).

**Infrastructure prep:**
- `6eebbb7` — schema + types added without API wiring, so the migration could land first and the modules could be split across slices.
- `d408111` — `TimescaleService.onModuleInit` auto-installs the TimescaleDB extension before calling `create_hypertable`. Real bug fix surfaced when slice 1 ran against a tmpfs-wiped test DB: the init migration only added PostGIS, so `create_hypertable()` failed at boot. Idempotent `CREATE EXTENSION IF NOT EXISTS timescaledb`.

Jest unit `testRegex` broadened to `*.state-machine.spec.ts` so the new pure-function spec runs alongside `*.spec.ts`.

### Slice 1b — Onboarding service + AI integration (commits `f709980`, `0e2bb64`)

Wires the state machine to the modules that actually write to the database.

- `OnboardingService` + controller (2 endpoints under `/api/v1/onboarding`):
  - `POST /turn` — body `{ userMessage?, chipChoice?, fieldValues? }` → `{ stepId, botMessage, chips, fields, progress, complete }`. Per-user state cached in Redis with 24h TTL.
  - `POST /skip` — closes the wizard for the session. Sets a Redis `onboarding:dismissed:{userId}` flag with 30-day TTL. Wizard re-opens after the flag expires if Network still doesn't exist.
- `AiService.generateOnboardingMessage(step, progress, userMessage?)` — assembles a step-aware prompt, calls `ClaudeAdapter.generate`, trims output to ≤300 chars. **Reuses the existing six-layer rate-limiter buckets** (deviation from plan, which called for a dedicated `ai:onboarding:{userId}` bucket — would have required `AiRateLimiterService` to accept bucket prefixes for a ~10-message-per-user wizard; not worth the refactor). When the adapter is unavailable, falls back to a hardcoded message per step (`ONBOARDING_FALLBACKS: Record<OnboardingStepId, string>` — TypeScript record type enforces every step has an entry).
- `DevicesService.createBrowserDevice(userId, browserDeviceId, name, mobility, networkId)` — idempotent on `(userId, browserDeviceId)`. Browser refresh that re-onboards returns the existing row instead of creating a duplicate. Bypasses the per-tier device-limit (browser-as-device shouldn't count against the user's quota).

**Plan deviations resolved in this slice:**
- The state machine emits `SaveNetwork` side-effects at the `isp` and `speeds` steps (not just `address`). Without those, the ISP and speed inputs collected in `progress` never reached the DB. Side-effect payloads at non-address steps include `name` as a sentinel — `OnboardingService.persistNetworkFields` strips it via `stripNameKey` so the field doesn't get clobbered.
- `SaveHomeIp` payload contains `ip: 'CURRENT_REQUEST'` sentinel because the state machine is pure (no `req.ip` access). The actual request IP is substituted by `OnboardingService.enactSideEffect` reading `req.ip` (after `app.set('trust proxy', 1)` — see slice 2b).

### Slice 2a — Per-device metrics ingestion (commit `6bc8f87`, Task #8)

`RawMetricPayload` gains optional `deviceId` and `tag` with type-guards. `DevicesService.findDeviceIdByBrowserDeviceId(userId, browserDeviceId)` resolves the localStorage-bound ID to a Device row's `id`. `RealtimeGateway.handleMetricsSubmit` accepts an extra `browserDeviceId` field on the inbound payload, resolves it via that method, and strips it before forwarding to `DataSourcesService.ingest`. Pre-onboarding the lookup returns null and the metric is stored against the user with no `deviceId` — still useful, just unattributed.

**Module cycle first appearance:** Adding `DevicesService` as a dependency of `RealtimeGateway` (which already depended on `ConflictResolutionModule`) created `Realtime ↔ Devices via Conflict`. Resolved by wrapping the `RealtimeModule` import in `conflict.module.ts` with `forwardRef(() => RealtimeModule)`, the `ConflictResolutionModule` import in `devices.module.ts` with `forwardRef(...)`, and the gateway constructor injection with `@Inject(forwardRef(() => DevicesService))`. **First use of `forwardRef` in the codebase** — kept in mind for slice 2b's parallel cycle.

### Slice 2b — On-home check + trust-proxy (commit `9e0c3d4`, Task #9)

`NetworksService.checkOnHome(userId, requestIp): Promise<{ networkId, onHome }>` — single-network MVP, returns `{networkId: null, onHome: false}` when no network exists, `homePublicIp` is null, or the request IP is empty. `RealtimeGateway.handleConnection` calls this after auth and emits `v1:network:onHome:changed` once per socket lifetime. The event re-fires after a `PATCH /networks/:id { homePublicIp }` — emitted via the same `conflictService.emitEntityEvent` path the other entity-update events use, but tagged `NETWORK_ON_HOME_CHANGED` so the frontend handler is separate.

`apps/api/src/main.ts` gains `app.set('trust proxy', 1)` so DigitalOcean's App Platform load balancer's `X-Forwarded-For` header is honored by Express's `req.ip`. Without that, `req.ip` would be the LB's internal IP, which never matches `homePublicIp` and pins `onHome` to false in production.

**Plan deviation:** the plan called this `on-home.middleware.ts` per request. It's actually a `NetworksService.checkOnHome` call from the gateway's `handleConnection` — one comparison per socket lifetime, not per HTTP request. Much less load and matches the event semantics ("on-home for this connection").

The parallel cycle `Realtime ↔ Networks via Conflict` was broken the same way as slice 2a — `forwardRef` on `networks.module.ts` for `ConflictResolutionModule`, and `@Inject(forwardRef(() => NetworksService))` on the gateway constructor.

### Slice 3 — Frontend Zustand stores (commit `c01b7f0`, Task #11)

Two new stores in `apps/web/store/`:
- `network.store.ts` — `{ network: NetworkSummary | null, onHome, isLoading, loaded, error }` + `setNetwork`, `setOnHome`, `load()`. `loaded` stays false on error so callers can distinguish "never loaded" from "loaded and empty" — the wizard auto-open in slice 6 depends on this.
- `onboarding.store.ts` — `{ wizardOpen, currentStep, progress, transcript[{id,role,content,timestamp}], chips, fields, submitting, complete, dismissedForSession, error }` + `openWizard`, `closeWizard`, `dismissForSession()`, `sendTurn(request)`. Initial welcome turn = `sendTurn({})` with no user bubble appended; subsequent turns derive a user bubble from `userMessage` → `chipChoice` → `fieldValues` (in that order of preference). In-flight guards on both `load()` (network) and `sendTurn()` (onboarding) prevent re-entrancy from React strict-mode double-render.

**First store unit tests in the web workspace.** 8 specs for `network.store`, 13 for `onboarding.store`, all TDD'd RED→GREEN. Required adding `'^react$': '<rootDir>/node_modules/react'` to `apps/web/jest.config.ts`: `zustand` is hoisted to the root `node_modules`, but RN/Expo pin `react@19.2.6` inside `apps/web/node_modules`. `getState`/`setState` don't actually use react at runtime — the `moduleNameMapper` just makes zustand's `react.mjs` import resolvable when ts-jest loads the module.

### Slice 4 — WizardSheet UI (commit `a947f2a`, Task #12)

New directory `apps/web/components/onboarding/`:
- `WizardSheet.tsx` — 60%-height bottom-sheet, fixed-positioned over the current route. Header has "Skip for now" → `dismissForSession()` and a plain × → `closeWizard()`. Auto-fires the welcome turn via `sendTurn({})` on first mount with empty transcript (ref-guarded against strict-mode double-render). Resets local field state when the active step's field-key signature changes (not just step ID — two steps reusing a key won't clobber mid-edit). Auto-scrolls transcript on every new message. Four-state model: loading (initial spinner with empty transcript), loaded (normal), submitting mid-conversation (typing-indicator bubble), error (red banner + Retry).
- `WizardMessage.tsx` — chat bubble, user (blue) vs bot (gray). Mirrors `AiMessage.tsx` but without streaming/usage-warning ornaments (onboarding is request/response, not streamed).
- `WizardChip.tsx` — pill button per server-supplied `OnboardingChip`. Forwards value to handler on press.
- `WizardField.tsx` — single text input keyed off `OnboardingField.kind`. `number`/`speeds` use numeric keyboards; `mac` forces uppercase; `address` carries a free-text placeholder.

The `'done'` step's `'close'` chip short-circuits to `closeWizard()` instead of POSTing another `/onboarding/turn`.

**Convention deviation flagged in commit:** the original plan called for `WizardSheet.test.tsx` (Jest + RTL) but CLAUDE.md and `apps/web/jest.config.ts` deliberately skip RN/JSX unit tests in favor of Playwright. Followed CLAUDE.md (no @testing-library/react in `apps/web/package.json`). Store unit tests in slice 3 cover the underlying behavior; component coverage lands via the manual Playwright smoke at end of slice 6.

### Slice 5 — LiveMarker upgrade + OnHomeBadge + DeviceDto extension (commit `c73e19b`, Task #13)

- `apps/web/lib/browser-device-id.ts` (+ 5 TDD'd unit tests) — `getBrowserDeviceId()` reads `localStorage['nodescope.browserDeviceId']` or generates a UUID via `crypto.randomUUID()` with a `Math.random` RFC4122-v4 fallback for older environments. SSR-safe — returns a transient id if `localStorage` is undefined so server-rendered code can still call it.
- `apps/web/lib/on-home.service.ts` — `subscribeToOnHomeUpdates()` mirrors `subscribeToMetricsUpdates`. Pipes `v1:network:onHome:changed` → `useNetworkStore.setOnHome`. The actual wire-up to the layout deferred to slice 6.
- `apps/web/components/map/LiveMarker.tsx` — was pulse-only. Now accepts `LiveMarkerInfo = { name?, latencyMs?, downMbps?, upMbps?, onClick? }` and renders a rounded name label above the pulse and an ambient-stats badge underneath. Click handler wired only when `onClick` is supplied so the marker stays passive pre-onboarding.
- `apps/web/components/map/OnHomeBadge.tsx` — green pill ("On home network") when `useNetworkStore.onHome === true`, grey pill ("Away from home") otherwise. **Returns null when `network === null`** so it doesn't appear pre-onboarding (a grey badge then would read as a complaint about state the user hasn't been asked to fix yet). **Display-only for PR 1.** The plan's "tap to save current IP as home" interactive flow needs a server endpoint that reads `req.ip` (browser can't detect its own public IP); that lands with PR 2's smart IP-rotation banner.
- `apps/web/components/map/DeviceMarker.tsx` — `BROWSER_CLIENT` added to `CATEGORY_COLORS` (`#2563eb` — same blue as the live marker) and `CATEGORY_ABBR` (`'WEB'`). Fixes the 2 pre-existing TS2741 errors that appeared after `6eebbb7` added the enum value.
- `apps/web/components/map/MapView.tsx` — geolocation handling split into two effects. The init effect captures the position into `livePosition` state; a dedicated effect builds the live marker from `livePosition + browserDevice + metrics`, rebuilding on each change. Marker fully torn down and re-added each cycle — the DOM tree is small enough (~3 nodes) that ~30s recreates are cheaper than diffing children in place.
- `apps/web/app/(app)/map.tsx` — renders `<OnHomeBadge/>` next to the `<Timestamp/>` in a top-left row. Right side stays clear for MapLibre's NavigationControl.

**DeviceDto extension.** Adding `browserDeviceId: string | null` to the shared interface so `MapView` could find which device row represents *this* browser. The schema field has existed since slice 1 but was never exposed through the API. Both DTO assemblers updated (`devices.service.toDto` and `map.service.deviceToDto`); optimistic `DeviceDto` literals in `device.store.ts` patched with `browserDeviceId: null`. **Required `npm run build --workspace=packages/shared` before re-running the api `tsc`** — `packages/shared` has a compile-to-dist step that the api consumes.

### Slice 6 — Final wire-up (commit `e0fb173`, Task #14)

- `apps/web/lib/browser-collector.service.ts` — every `WS_EVENTS.METRICS_SUBMIT` payload now carries `browserDeviceId: getBrowserDeviceId()`. The gateway (slice 2a) resolves it → `deviceId` before forwarding to ingest.
- `apps/web/lib/network-events.service.ts` (renamed from `on-home.service.ts`) — added `subscribeToNetworkUpdates()` alongside `subscribeToOnHomeUpdates()`. The new helper handles `v1:network:updated` and pipes the payload's `NetworkDetail` → `useNetworkStore.setNetwork` as a `NetworkSummary` (stripping `homePublicIp` to match the store's chosen shape). Rename is loss-free — nothing imported from the old filename yet.
- `apps/web/app/(app)/_layout.tsx` — after `websocketService.connect()` in `getSession.then`:
  1. `subscribeToOnHomeUpdates()` + `subscribeToNetworkUpdates()` register synchronously, AFTER `connect()` runs, because `websocketService.on()` is a no-op while its internal socket is null.
  2. `useNetworkStore.getState().load()` — populates the cached `NetworkSummary`. When the promise resolves with `loaded=true && network===null && !useOnboardingStore.dismissedForSession`, calls `openWizard()`. The WizardSheet's own effect auto-fires the welcome turn from there.
- `<WizardSheet/>` rendered as a sibling of `<Tabs>` so the overlay covers the tab bar when active. Returns null when `wizardOpen=false`, so it costs nothing in the steady-state map view.

### Outstanding from Phase 13 (carried forward)

- **Manual browser smoke** has not been exercised end-to-end yet. The next session's first task: sign up a fresh user, walk every step of the wizard, confirm `OnHomeBadge` and the persisted `LiveMarker` work, and that page reload during the same auth session doesn't re-open the wizard (because `network !== null` keeps the auto-open trigger from firing).
- **Pre-existing WS subscriber ordering bug** (separate refactor, not blocking slice 6). `subscribeToMetricsUpdates`, `subscribeToEntityEvents`, `subscribeToAiEvents`, and the `reconnect` handler in `_layout.tsx` are all registered OUTSIDE `getSession.then`, where `websocketService.on()` is a no-op (internal socket is null). Slice 6 worked around this for task-#14 subscribers by registering inside the `.then`. Worth fixing the legacy subscribers in a follow-up — possibly by buffering subscriptions inside `websocketService` until `connect()` runs, so the call site no longer needs to think about ordering.
- **`docs/API_Design.md` and `docs/DB_Schema.md`** updated locally (they're gitignored) with the new endpoints, error codes, WS events, and the Network/Device/DeviceMetric schema additions. Section markers in the local copies are: API_Design § 2.7 (NETWORK_001/002, ONBOARD_001), § 2.8 (`NetworkSummary`/`NetworkDetail` + `DeviceDto.browserDeviceId`), new § 8 (Network endpoints), new § 9 (Onboarding endpoints), § 13.3 (`v1:network:updated`, `v1:network:onHome:changed`, `v1:onboarding:turn`); DB_Schema § 2.2 (BROWSER_CLIENT), new § 2.5 (`DeviceMobility`), § 7.4 (Network model + Device extensions), § 7.5 (DeviceMetric.deviceId/tag).

### Verification at end of Phase 13

| Suite | Result |
|---|---|
| API Unit | 16/16 suites, **199/199** tests |
| API Integration | 7/7 suites, **54/54** tests (no integration changes after slice 2) |
| API E2E for touched modules | devices/map/networks: 3/3 suites, **27/27** tests |
| Web Jest | 4/4 suites, **31/31** tests (+ 26 since pre-Phase-13: 8 network.store + 13 onboarding.store + 5 browser-device-id) |
| `tsc --noEmit` apps/web | clean |
| `tsc --noEmit` apps/api | clean (after rebuilding `packages/shared`) |

Total of **10 commits** on `feat/onboarding` (master tip `6eebbb7` is the schema-only prep that landed before the branch forked): `d408111`, `0778c40`, `f709980`, `0e2bb64`, `6bc8f87`, `9e0c3d4`, `c01b7f0`, `a947f2a`, `c73e19b`, `e0fb173`. Branch is **code-complete**; remaining work is manual verification + the existing-subscriber refactor noted above.

---

## Post-Phase 13 — Smoke fixes, hardening & polish (2026-05-21 → 2026-05-28)

The "code-complete" tag at the close of Phase 13 turned out to need a follow-up sweep. Manual smoke, a 4-state UI audit, and cross-platform infra glitches surfaced 10 commits' worth of follow-on work. Listed below in commit order.

### Smoke pass — 2026-05-21 / 2026-05-22

Five commits driven by the first manual walk-through of the onboarding → map flow:

- **`26f6530`** — `OnboardingTurnDto` required `browserDeviceId` (MinLength 1) on every POST, but the store only injected it when the caller supplied it. The welcome turn 400'd. Store now reads `getBrowserDeviceId()` and injects on every call.
- **`39b421e`** — `OnboardingService.handleTurn` threw `ONBOARD_001 ALREADY_COMPLETE` whenever a Network row existed. But the wizard creates the Network row at the address step (via `SaveNetwork`), so every subsequent turn 409'd. Guard now requires *both* "no Redis state" AND "Network exists" before rejecting.
- **`8cf7f5e`** — Tap-to-place flow. Replaced the manual lat/lng text inputs on `DeviceForm` with a "tap '+' → tap map → pre-filled form" gesture. `MapView` accepts `placementMode` + `onMapClick` props and swaps the canvas cursor to `crosshair` only while placing. Device-marker clicks bubble through their own listeners (with `stopPropagation`) so the placement handler only fires on empty map.
- **`3c16153`** — Auto-zoom to newly created device. Every `DeviceCategory` has a `minZoom` in `DEVICE_CATEGORY_CONFIG`; markers below it are filtered out. A user placing a COMPUTER (`minZoom 18`) from zoom 13 saw nothing afterward — looked like a silent failure. After a successful create, fly to the new device at `max(category.minZoom + 0.5, 13)`. The filter itself is preserved (keeps the map readable at scale).
- **`3943096`** — Two browser-only bugs:
  1. Device markers snapped to (0, 0) at the end of every zoom animation. Our `applyMarkerStyles` overwrote MapLibre's `transform: translate(...)` with `transform: scale(...)`. Fix: wrap each marker so MapLibre's translate lives on the outer div and our scale on an inner child — the two transforms can no longer collide.
  2. Delete buttons did nothing. RN-Web's `Alert.alert` is a `console.warn` stub. Swap to `window.confirm` for the destructive prompt and `window.alert` for the error toast across `map.tsx`, `equipment.tsx`, and `circuits.tsx`. Established the swap pattern this section will later finish (see "Alert.alert leftovers" below).

### `bd4f8f5` (2026-05-27) — WS subscriber buffer

Resolves the "pre-existing WS subscriber ordering bug" Phase 13 flagged as deferred. `websocketService.on/off` had been no-ops before `connect()`, so four subscriptions registered synchronously in `_layout.tsx` (device/circuit live updates, AI token streaming, offline-queue flush on reconnect) were silently dropped on every cold session bootstrap. Adds Socket/Manager subscription registries that survive disconnect and re-attach on every fresh socket. With buffering in place, `_layout.tsx` registers all subscribers synchronously at the top of the useEffect — Slice 6's wedge-into-`.then` workaround is gone. Includes four hardening fixes from code review: PONG listener leak in `measureLatency`, half-connected socket teardown in `connect()`, duplicate-handler skip in `on()`, and `removeAllListeners()` wired into test `afterEach`.

### `6dda8a3` (2026-05-27) — On-home recompute broadcast + jest OOM cap + Prisma cross-platform

**Feature.** Open browser tabs missed the on-home transition when a user confirmed their home IP via the `confirmHomeIp` chip or when a network PATCH updated `homePublicIp` directly. Each socket's `socket.data.onHome` was set once at handshake time from the request IP, and only the originating tab learned of changes.

`recomputeOnHomeForUser(userId)` is now on both `IRealtimeService` and `RealtimeGateway`. It pulls all sockets in `user:{userId}` from the Socket.io room, re-runs `NetworksService.checkOnHome` per-socket (each socket has its own handshake IP), updates `socket.data.onHome`, and emits `NETWORK_ON_HOME_CHANGED` per socket. Wired into:
- `NetworksService.updateNetwork` — triggers recompute only when `homePublicIp` is in `patch.changes`. Non-IP edits don't fire it.
- `OnboardingService` — triggers right after `SaveHomeIp` enacts.

Module wiring: `NetworksModule` and `OnboardingModule` both `forwardRef(() => RealtimeModule)`. RealtimeModule already forwardRefs both, so the cycle is broken from either side.

**State machine adjustment.** `routerMac` / `modemMac` mark `name` required and `macAddress` optional. Both steps advance on name-only input; `SaveDevicePayload.macAddress` widens to `string | undefined`. Surfaced because the onboarding service spec needed a clean way to drive `SaveHomeIp` without the wizard getting stuck on a router MAC the user hadn't bothered to enter.

**Jest infra.** Capped `--maxWorkers=2 --workerIdleMemoryLimit=512MB` on the API unit/integration/e2e scripts in `apps/api/package.json`. Root cause of an earlier "agent OOM'd at exit 137": the 24-core sandbox was forking ~22 unbounded ts-jest workers, each spinning up its own TS compiler against a (separately broken) module-resolution state. Capping workers is the durable fix; even with module resolution clean, parallelism > 2 is heat with no benefit on this sandbox profile.

**Prisma `binaryTargets`.** `apps/api/prisma/schema.prisma`'s generator block adds `["native", "debian-openssl-3.0.x"]`. A `prisma generate` run on Windows previously produced only the Windows query engine; Linux runtimes (sandbox, DigitalOcean App Platform builds) then threw `PrismaClientInitializationError` when loading the client at test teardown. `native` still resolves so the Windows binary continues to be generated for local dev.

### `c2b4c4e` (2026-05-28) — 4-state model audit fixes

An audit pass on `apps/web` against CLAUDE.md's four-state UI rule flagged four candidate gaps. Three real, one false positive:
- **`settings.tsx:55`** — data-sources fetch silently swallowed errors with `// non-critical — show empty`, rendering "No data sources configured" for both genuinely-empty and failure cases. New `sourcesError` state distinguishes them: error path shows a red row + Retry button; empty stays for the genuine zero-sources case.
- **`AiChatWindow.tsx:87`** — error banner had no Retry. Failed `sendMessage` stranded the user — error text shown, no recovery path short of retyping. Added `retryLastMessage` to `ai.store`: walks `messages` backward to find the last user message, drops trailing empty-streaming assistant bubbles (the WS-error path leaves these), clears `error`, starts a fresh assistant message, and re-emits with the same `conversationId`. Idempotent under concurrent calls via the existing `isStreaming` guard. Preserves partial-content streaming bubbles — only fully-empty ones are dropped.
- **`AiChatWindow.tsx:136`** — usage row had no loading state. Wired the existing `isLoadingUsage` (already on the store, just unused) to a spinner + "Loading usage…" while `loadUsage()` is in flight and `usage` is null.
- **`clients.tsx:104`** — false positive. `Timestamp` is already nested inside the `StaleDataOverlay` at line 152, and `Timestamp.tsx:44` colors amber when stale at the 90s threshold. No change.

### `7eb3dd9` (2026-05-28) — ai.store unit spec backfill

`c2b4c4e` added `retryLastMessage` but `ai.store` had no spec file at all — out of step with `network.store` and `onboarding.store`. Backfilled the entire store: 18 specs across 9 actions (`addUserMessage`, `startAssistantMessage`, `appendTokenToCurrentMessage`, `completeCurrentMessage`, `setError`, `loadUsage`, `clearConversation`, `sendMessage`, `retryLastMessage`). Mocking mirrors `onboarding.store.spec.ts`: axios mocked via `jest.unstable_mockModule`; `websocketService` is a singleton instance so `jest.spyOn(websocketService, 'emit')` is the cleanest path (module-mocking relative paths is flaky under ts-jest ESM, noted in the prior store specs).

### `7e2888d` (2026-05-28) — Tap-to-save: OnHomeBadge becomes pressable

Closes the deferred Phase-13 polish item. Previously `OnHomeBadge` was display-only because the browser cannot detect its own public IP, so the "Away from home" state offered the user no path forward.

**Server.** New `POST /api/v1/networks/:id/set-home-ip` (no body). Reads `req.ip` via the established pattern (X-Forwarded-For aware via `app.set('trust proxy', 1)` per `9e0c3d4`). `NetworksService.setHomeIpFromRequest` loads the network and delegates to `updateNetwork` with a one-field changeset. That reuses the existing optimistic-concurrency dance and — critically — the `homePublicIp` trigger that already calls `recomputeOnHomeForUser`. No new emit code; the WS push cascades through the recompute pathway.

**Client.** `OnHomeBadge` becomes a `TouchableOpacity` only when `!onHome && !savingHomeIp`. Tap fires `window.confirm` (same RN-Web pattern as `3943096`). On confirm, `network.store.setHomeIp()` POSTs the endpoint, strips `homePublicIp` from the response, updates the cached `NetworkSummary` optimistically. The badge cycles through a spinner+"Saving home IP…" state until the response or WS push completes. The WS `NETWORK_UPDATED` + `NETWORK_ON_HOME_CHANGED` then update all other open tabs.

**Tests:** +3 service specs, +2 controller e2e specs, +5 store specs. API unit 213/213, web jest 63/63.

### Alert.alert leftovers (`7791ddc`, 2026-05-28)

Four `Alert.alert` call sites remained active despite RN-Web's stub. Swapped to `window.alert` with the `typeof window !== 'undefined'` guard, matching `3943096`'s pattern:
- `apps/web/app/(app)/map.tsx:144` — failed device save toast
- `apps/web/app/(app)/equipment.tsx:93` — failed device save toast
- `apps/web/app/(app)/circuits.tsx:66` — failed circuit save toast
- `apps/web/app/(app)/settings.tsx:82` — successful profile save toast

`Alert` removed from all four files' `react-native` imports. Comments referring back to "RN-Web Alert.alert is a stub — see comment in map.tsx" remain as breadcrumbs for future readers.

### device.store + circuits.store unit specs (`77069ef`, 2026-05-28)

Backfilled the remaining store specs after the same audit that flagged `ai.store`'s missing spec. Both stores share the optimistic-CRUD + offline-queue shape introduced in earlier phases — covering them aligns the test discipline across the entire `apps/web/store/` directory.

`device.store.spec.ts` — 17 specs across 7 actions:
- `loadDevices()` — happy path, in-flight short-circuit, error path leaves `devices` unchanged and `loaded` false.
- `upsertDevice` / `removeDevice` — direct setters.
- `createDevice()` — optimistic placeholder inserted with `temp-<ts>` id; mid-flight snapshot proves it's visible; server row swaps it; rollback removes the placeholder *and* queues an offline op on failure.
- `updateDevice()` — diff-based changeset; no PATCH and same-ref return when input has no real changes; optimistic apply; rollback to previous + queue on failure.
- `deleteDevice()` — optimistic remove; restore + queue on failure; silent no-op when the deviceId doesn't match.
- `flushOfflineQueue()` — drains the queue through the normal CRUD paths; remaining ops re-queue themselves if they fail individually, so the queue partially shrinks rather than all-or-nothing.

`circuits.store.spec.ts` — 18 specs, same shape plus pagination:
- `loadCircuits()` / `loadNextPage()` — including the cursor URL-encoding subtlety (`abc/def+ghi` → `abc%2Fdef%2Bghi`) and the dual-guard "no nextCursor OR already loading" no-op.
- `deleteCircuit()` — also clamps `total` at zero to defend against the rare "already-stale total + extra delete" race.

**Jest cap on apps/web/package.json.** Running `npm test` against the now-7 suites surfaced the same OOM cascade fixed in `6dda8a3` for API tests: web's jest script was uncapped, the sandbox forked workers per core, and 2 suites died with SIGKILL after ~3 hours of wall-clock spin (most of which was the sandbox stalled, not real work). Added `--maxWorkers=2 --workerIdleMemoryLimit=512MB` to apps/web/package.json. Run time dropped from "killed" to **19s for 7 suites / 100 tests**. Web jest now matches API jest's resource discipline.

### Tap-to-relocate existing device (this commit, 2026-05-28)

Closes the deferred follow-up from `8cf7f5e`: tap-to-place existed for create but editing a device left coords read-only — the user had to delete + recreate to move a device.

`DeviceForm` gains `onRelocate?: () => void`. When set (edit mode only), a "Tap to relocate" link renders in the Location row's header next to the read-only coord text. Press routes back to `map.tsx`, which:
1. `handleStartRelocation` — captures the in-flight `editDevice` into a new `relocatingDevice` state, closes the form (`formMode = null`), enters placement mode.
2. Map shows the existing placement banner with copy switched to "Tap the map to relocate \<name\>".
3. User taps map → `handleMapClick` sees `relocatingDevice` is set, captures `pickedCoords`, re-opens the form (`formMode = 'edit'`, same `editDevice` reference), clears `relocatingDevice`.
4. Form renders with `placedLatitude`/`placedLongitude` carrying the new pick; `effectiveLatitude` in `formatCoord` resolves to the new value first.
5. User taps Save → `handleFormSubmit` calls `updateDevice(id, editDevice, input)`; `device.store.updateDevice` diffs the input against `editDevice` (which still holds the OLD coords). Latitude and longitude land in the changeset and PATCH /devices/:id. Optimistic update is applied immediately on the map.

The `placedLatitude` / `placedLongitude` guard in `DeviceForm` render switched from `formMode === 'create' ? ... : null` to a direct passthrough — they're correct for both modes now (edit-mode `pickedCoords` is non-null only after a relocate round trip).

`handleCancelPlacement` and `handleFormClose` both clear `relocatingDevice` so the state can't leak across flows.

**Known limitation flagged for follow-up:** Unsaved form fields are lost across the relocate round trip. `formMode` is set to `null` during placement, so the `DeviceForm` unmounts; the `useForm` state is recreated on remount and the `useEffect` at line 103 resets values to the device's persisted fields. If the user typed half a new name then clicked "Tap to relocate", their typing is gone. Acceptable for v1 — most relocate flows aren't combined with simultaneous text edits. A future improvement would keep `DeviceForm` mounted but visually hidden during placement (e.g. via a `hidden` prop or `display:none` wrapper) so `useForm` state survives.

Tests: device.store.updateDevice is already covered by `77069ef`'s spec — the diff + optimistic + rollback paths exercise the same data path the relocate uses. The UI orchestration in `DeviceForm` + `map.tsx` falls under the project's "Playwright covers RN/JSX, not jest" convention (see Phase 13 slice 4). No new jest specs.

### Verification at end of post-Phase-13 polish (2026-05-28)

| Suite | Result |
|---|---|
| API Unit | 16/16 suites, **213/213** tests |
| Web Jest | 5/5 suites, **63/63** tests |
| `tsc --noEmit` apps/api | clean |
| `tsc --noEmit` apps/web | clean |
| API Integration / E2E | not re-run in this session (no docker access) — 2 new networks.controller.e2e specs land here for next local run |
| Web bundle entry chunk | deferred to Windows; lightningcss linux-x64-gnu binding missing in the sandbox. No new heavy deps since `412 KB` baseline on 2026-05-16 |
| Manual browser smoke | still outstanding from Phase 13. User explicitly deferred during this polish session. |

### Docs audit + per-IP AI rate-limit code split (this commit, 2026-05-28)

Cross-doc + docs-vs-code audit across CLAUDE.md, PRD, API Design, DB Schema, and PROGRESS.md. Three parallel scan agents surfaced findings, fixes applied in three batches.

**Batch A — doc-only consistency.** `MULTI_PROPERTY` added to both AccountTier blocks in `docs/DB_Schema.md` (Prisma had it; doc didn't). DeviceMetric §5 picked up the `deviceId String?` + `tag String?` + per-device-time index that Phase 13 added but the canonical block hadn't. Network header de-Phase'd (it's MVP) and added to the §1 summary table. `docs/PRD.md` `AI_MODEL` corrected to `claude-sonnet-4-6` (was stale `claude-sonnet-4-20250514`). WS event counts updated 17 → 20 in `CLAUDE.md` and `docs/API_Design.md` header to match the Doc Control section. AI_004 reworded in three places to reflect that it's only thrown when fallback context assembly itself fails — normal Claude API outages return 200 with `providerStatus: 'unavailable'`; the response shape doc now lists `providerStatus`. PROGRESS.md "Last updated" header bumped from 2026-05-19 → 2026-05-28.

**Batch B — password reset endpoint.** Verified against `node_modules/better-auth/dist/api/routes/password.mjs:20` that Better Auth 1.x's canonical route is `/request-password-reset`; `/forget-password` is an alias (rate limiter honors both). `docs/API_Design.md` had it backwards in three spots (§2.5 rate-limit table, §4 endpoint heading, the "Better Auth's chosen path" note). Canonical name applied everywhere; alias relationship now documented. `apps/api/src/auth/better-auth.config.ts` comment also updated to reference the canonical route.

**Batch C — `set-home-ip` docs + GEN_004 split.** `docs/API_Design.md` §14.6 added: empty body, returns `NetworkDetail`, emits same WS events as a PATCH-with-IP-change. Per-IP AI rate limit was throwing `AI_001 AI_RATE_LIMIT_HOURLY` — same code as the per-user hourly check, ambiguous. Swapped to `GEN_004 RATE_LIMITED` to separate anti-abuse from per-user quota; matches Better Auth's own per-IP convention (`docs/API_Design.md` lines 430, 483). Spec test renamed and re-asserted. `docs/PRD.md` §6.5.2 rate-limit list reordered to match code execution (hourly → daily → monthly tokens → per-IP) with the GEN_004 vs AI_001 distinction annotated.

Tests: `npm run test:unit --workspace=apps/api` → **16/16 suites, 213/213 tests** pass after the GEN_004 rename. Tracked changes (4 files): `PROGRESS.md`, `ai-rate-limiter.service.ts`, `ai-rate-limiter.service.spec.ts`, `better-auth.config.ts`. The `docs/**` edits are local-only (gitignored per CLAUDE.md).

### Removed unused `v1:connection:status` WS event + endpoint-count correction (this commit, 2026-05-28)

Follow-up to the docs-alignment commits. A second audit pass (code-vs-now-aligned-docs) flagged two real drifts:

**1. `v1:connection:status` was typed and documented but had no server-side producer.** The intended payload (`{ status, message }`) was already delivered to the client by socket.io's native `connect`/`disconnect`/`reconnect_attempt` events — `apps/web/lib/websocket.service.ts:58-75` calls `useUiStore.setConnectionStatus()` directly from those handlers. The custom event lived only in `WS_EVENTS`, an API_Design §13.3 row, a SAD §6.5 row, and a `pushToTier` test stub. Removed all four. The `ConnectionStatus` *type* stays — `RealtimeService.getConnectionStatus()` (Redis-backed socket-set lookup) and the UI store both consume it. The `pushToTier` spec was rewritten to use `v1:metrics:update` with a real `MetricsDto` payload, preserving coverage of the broadcast mechanism without referencing a dead event. WS event count: 20 → **19** (3 client→server, 16 server→client).

**2. REST endpoint count was 44 in the docs but only 43 in code.** The previous docs-alignment commit took the Doc Control section's `44` at face value; counting `@Get/@Post/@Patch/@Put/@Delete` decorators across all 13 controllers gives `users 6 + devices 5 + fiber-runs 5 + connections 4 + circuits 5 + map 3 + clients 1 + ai 3 + health 1 + bandwidth 2 + networks 6 + onboarding 2 = 43`. Corrected the header + Doc Control to 43 with an audit-trail note.

Tests: `npm run test:unit --workspace=apps/api` → **16/16 suites, 213/213 tests** pass (same total — the realtime spec substituted one event name, didn't add or remove tests). Tracked changes (4 files): `PROGRESS.md`, `packages/shared/src/types/realtime.types.ts`, `apps/api/src/realtime/__tests__/realtime.service.spec.ts`, `CLAUDE.md`. `docs/**` edits are gitignored.

**Audit findings deferred** (not in this commit, surfaced for follow-up): (a) `ONBOARD_001` is overloaded — code throws it for `ALREADY_COMPLETE` (409) but doc reserves it for `ONBOARDING_INVALID_STEP` (400); splitting into ONBOARD_001/002 needs an architectural call. (b) `propertyId` reserved-field story is inconsistent across CLAUDE.md (Device + DeviceMetric reserved), DB_Schema.md (Network.propertyId reserved), and `schema.prisma` (none present); needs a policy decision before any migration. (c) `DeviceMetric` third index has `(sort: Desc)` in code; doc was updated without it in the prior batch — a one-line doc fix.

### Reserved Network.propertyId, split ONBOARD_001/002, fixed DeviceMetric index sort (this commit, 2026-05-28)

The three findings deferred above, tackled in one batch.

**1. Network.propertyId reserved for the Multi-Property tier.** Decided the post-MVP data model: `User → Property (1:many) → Network (1:many) → Device (1:many)`. That puts the FK on Network — not on Device or DeviceMetric as CLAUDE.md previously claimed. Added `propertyId String?` + `@@index([userId, propertyId])` to the Network model in `schema.prisma`, plus a new migration `20260528000000_reserve_network_property_id` that adds the column and index (purely additive — nullable, no default, no behavior change). CLAUDE.md's "Reserved post-MVP" section was rewritten to name `Network.propertyId` and explicitly NOT reserve `Device.propertyId` / `DeviceMetric.propertyId` — devices reach Property via `Device → Network → Property`; denormalize only when a measured query-perf need proves the join too expensive. DB_Schema.md's existing comment ("Mirrors Device.propertyId") was wrong about the structural role and got rewritten. Test fixture in `networks.service.spec.ts` updated to include `propertyId: null` so `tsc` against the regenerated Prisma client stays clean (Jest itself was already lenient with mock shapes; only `tsc` caught the missing field).

**2. `ONBOARD_001` overload split.** `onboarding.service.ts:71` was throwing `ONBOARD_001 ALREADY_COMPLETE` with HTTP 409, but the doc reserved `ONBOARD_001` for `ONBOARDING_INVALID_STEP` with HTTP 400 — two genuinely different conditions sharing one code. Created `ONBOARD_002 ONBOARDING_ALREADY_COMPLETE` (409) for the "user has a Network and no in-flight wizard state — can't restart" case; kept `ONBOARD_001 ONBOARDING_INVALID_STEP` (400) for state-machine input rejection. Updated the throw, the unit-test expectation, and the API_Design.md §2.7 error code table + §15.1 endpoint Errors line.

**3. DeviceMetric `(userId, deviceId, time)` index — added `(sort: Desc)` in doc.** Code (`schema.prisma:304`) has `time(sort: Desc)`; the canonical model block in DB_Schema.md §5 didn't include `Desc` (residual from the earlier Phase 13 view). DESC matches the latest-first scan pattern the read-side actually uses (`getLatestForUser`, `getRecentForUser`). §5 model block + §9 indexes summary updated.

Verification: `prisma validate` clean, `tsc --noEmit` clean for both apps/api and apps/web, `npm run test:unit --workspace=apps/api` → **16/16 suites, 213/213 tests** pass. Migration NOT applied locally (no docker access in this sandbox); next `prisma migrate dev` against a live DB picks it up automatically — purely additive so safe to deploy without coordination.

Tracked changes (6 files): `PROGRESS.md`, `schema.prisma`, the new `migration.sql`, `onboarding.service.ts`, `onboarding.service.spec.ts`, `networks.service.spec.ts`. Local-only edits (gitignored): `CLAUDE.md` reserved-fields section + "What Is Not in MVP" line + PR checklist; `docs/API_Design.md` error table + onboarding endpoint; `docs/DB_Schema.md` `Network.propertyId` comment + DeviceMetric index sort.

### Guard unit spec backfill — tier.guard + role.guard (this commit, 2026-05-29)

Audit pass found three guards under `apps/api/src/auth/guards/` and zero dedicated spec files. AuthGuard is effectively covered indirectly (10+ e2e specs assert `AUTH_002 SESSION_INVALID` and `@Public()` passthrough is exercised by every health/bandwidth/auth controller test), but `TierGuard` and `RoleGuard` had **no test reaching their failure paths anywhere in the suite** — `AUTH_003 INSUFFICIENT_TIER` and `AUTH_004 INSUFFICIENT_ROLE` were grep-clean across the entire test tree.

Both guards are registered globally in `app.module.ts:77-80` but `@RequireTier` and `@RequireRole` are exported and never applied to any production endpoint — every real request short-circuits at the "no metadata → return true" branch. So the failure paths are dead code today, but they ship to prod, and the moment billing lands (post-MVP) and `@RequireTier` gets applied for the first time, the first real exercise of the comparison logic would be in production with zero regression net. The `TIER_ORDER` ranking, the `?? 0` fallbacks on both sides of the `<` comparison, and the AUTH_003/004 throw shapes are exactly the kind of code that drifts under refactor without anyone noticing.

**Spec config change.** `jest.unit.config.ts` testRegex was `.*\\.(service|state-machine)\\.spec\\.ts$` — would have silently skipped a `*.guard.spec.ts` file. Added `guard` to the alternation: `.*\\.(service|state-machine|guard)\\.spec\\.ts$`. Regex change is additive: every previously-matched file still matches; only newly-matched files are the two new guard specs. No risk to existing suite discovery.

**`tier.guard.spec.ts` — 10 specs across 4 groups:**
- *No `@RequireTier` metadata*: passthrough; reads `REQUIRED_TIER_KEY` via `getAllAndOverride([handler, class])`.
- *Tier comparison*: equal passes; higher passes; lower throws; throw payload exactly `{ code: 'AUTH_003', message: 'INSUFFICIENT_TIER' }`.
- *Missing/unknown user tier*: missing `request.user` defaults to PERSONAL_FREE and blocks higher tiers; missing `user.tier` defaults to PERSONAL_FREE; unknown `user.tier` string ranks 0.
- *Unknown required tier — fail-open*: documents and locks in the current behavior that an unrecognized required-tier name maps to rank 0 and lets every caller through. Inline comment flags this for any future policy change.

**`role.guard.spec.ts` — 7 specs across 2 groups:**
- *No `@RequireRole` metadata*: passthrough; reads `REQUIRED_ROLE_KEY`.
- *Metadata set*: any non-empty `orgRole` passes; missing `orgRole` throws; missing `request.user` throws; empty-string `orgRole` (falsy) throws; throw payload exactly `{ code: 'AUTH_004', message: 'INSUFFICIENT_ROLE' }`. Inline comment notes the Organization plugin is post-MVP (Priority 4) — current "any role passes" behavior is correct for MVP, must extend to role-specific checks when the org plugin ships.

**`auth.guard.spec.ts` deliberately skipped.** It's already covered indirectly by ~10 e2e specs that assert `AUTH_002` for unauth requests on `/users/me`, `/devices`, `/ai/*`. A unit spec would need to stub `auth.api.getSession` (the only thing not exercised by e2e is the `request.user = session.user` attachment, and every authed e2e proves that works). Adding it now would mostly duplicate signal.

Iteration note: the first run had 2 failures, both from `expect.anything()` in the "looks up the key" assertion — the matcher rejects `null`/`undefined`, and my `buildContext` was returning `undefined` from `getHandler()`/`getClass()`. Replaced with a named handler function and a named class, which is also more realistic. Re-run passed.

Verification: `npx jest --config jest.unit.config.ts src/auth/guards` → **2/2 suites, 17/17 tests** pass. Full suite math: 213 previous + 17 new = **18/18 suites, 230/230 tests** (the 16 unchanged suites all passed in the prior full run; regex change is purely additive so no previously-matched suite gets dropped).

Tracked changes (3 files): `PROGRESS.md`, `apps/api/jest.unit.config.ts`, plus 2 new spec files under `apps/api/src/auth/guards/__tests__/`. Local-only edit (gitignored): `CLAUDE.md` "Test file naming" section noting the additional `*.state-machine.spec.ts` and `*.guard.spec.ts` patterns matched by the unit config.

## Risk-audit follow-ups (branch `fix/risk-audit-followups`, 2026-05-30)

A read-only orientation audit of `feat/onboarding` surfaced six correctness/robustness/boundary risks; this branch fixes all six, each as its own commit, off `feat/onboarding`. Net new verification at the end of the batch: api unit **19 suites / 238 tests**, api integration (map + data-sources, real PostGIS) **8 tests**, api e2e (ai + auth + map, full app boot) **24 tests**, web store/onboarding specs **73 tests**, web `tsc --noEmit` clean.

**1. Map/metrics raw-SQL column drift (`fix(api): include Phase-13 device columns…`).** `map.repository.ts` `DEVICE_COLUMNS` was never updated for Phase 13, so the bbox endpoint silently returned `browserDeviceId: undefined` for every device — the `$queryRawUnsafe<Device[]>` cast hid the omission, and `map.service.deviceToDto` read the missing field. `data-sources.repository.findLatestForUsers` likewise dropped `deviceId`/`tag`. Added the columns to both raw selects and pinned them with a new `map.repository.spec.ts` integration test (creates a `BROWSER_CLIENT` device, asserts the columns round-trip) plus an extended data-sources spec.

**2. Offline mutation queue hardening (`fix(web): persist offline queue…`).** Three compounding gaps against the offline-first promise: the queue was in-memory only (reload/tab-close while offline dropped queued edits silently); flush was bound only to the manager `reconnect` event, not `connect` (the 30s offline-retry path fires `connect`), stranding recovered ops; and a stale-`baseVersion` replay looped forever on `SYNC_001`. Now: queue persists to `localStorage` (`ns:offlineQueue:{devices,circuits}`); `_layout` flushes on both `connect` and `reconnect` behind an in-flight guard; `drainOfflineQueue` classifies failures (409 → give up immediately, transient → retry to `MAX_REPLAY_ATTEMPTS=5` → give up) and surfaces dropped edits via a new `SyncErrorBanner`. Whole-entity-version conflict model is unchanged (field-level merge is still post-MVP).

**3. Onboarding lockout on lost wizard state (`fix(onboarding): resume instead of locking out…`).** `handleTurn` threw `ONBOARD_002` whenever there was no Redis state but a Network existed — but `SaveNetwork` creates the Network at the address step, so a 24h state-TTL expiry mid-flow locked the user out permanently (and the web Retry re-POSTed the 409 in a loop). Gate the lockout on a durable `onboarding:completed:{userId}` marker (1-yr TTL, written only on completion) instead of network existence: no marker + no state now resumes from the top, which is safe because the side effects are idempotent (`createBrowserDevice` upserts, `persistNetworkFields` updates the existing network, infra-device create swallows duplicate-name errors). Web `sendTurn` closes the wizard on a 409 ONBOARD_002 rather than looping. *Residual:* a full Redis flush would still lose the marker — a `User.onboardingCompletedAt` column would be bulletproof but needs a migration.

**4. AI conversation authz + onboarding rate bucket (`fix(ai): scope conversations by user…`).** Conversation history was keyed `ai:conv:{conversationId}` with no user scoping, so any authenticated user who knew a conversation UUID could read or delete it. Namespaced the key by userId (`ai:conv:{userId}:{conversationId}`) across `getHistory`/`appendMessages`/`deleteConversation`; the controller passes `user.id`. Separately, onboarding message generation shared the chat rate-limit counters (a quota-exhausted chat session could hard-block the wizard) — added an additive `scope` to `AiRateLimiterService` and ran onboarding under its own bucket; the default (no-scope) keys are byte-identical to before, so chat counters are untouched.

**5. Auth throttle on get-session (`fix(auth): exempt get-session…`).** The auth catch-all applied the strict 5-req/15-min `auth` limiter to all of `/api/auth/*` including `get-session`, which the SPA hits on every navigation (and twice on cold start) — a spurious-429 risk in prod, flagged by an in-file TODO. Split `get-session` into its own handler that skips the `auth` bucket and falls back to the lenient global `default` limiter; the wildcard keeps the strict limiter for sign-in/sign-up/reset.

**6. Boundary + dead-code (`refactor(api): move AI network context to a repository…`).** `NetworkContextProvider` queried Prisma directly (Rule #2 violation) → extracted `NetworkContextRepository`. Removed the dead `ConflictResolutionService.publishEntityUpdate` path — it published to the `nodescope:entity:updated` Redis channel that nothing ever subscribed to (cross-instance fan-out runs through the Socket.io redis-adapter); dropped the channel constant, the now-unused Redis injection + module import, its unit test, and five stale `publishEntityUpdate: jest.fn()` mock lines.

**Deliberately left for sign-off** (not in this branch): server-side idempotency keys for offline create-replay (device creates are already dedup'd by name-uniqueness → clean give-up; only circuits could duplicate on a lost-response replay); the durable `User.onboardingCompletedAt` upgrade for #3; the unused HTTP `POST /v1/ai/message` endpoint (tested + documented — removing it is a deliberate API-surface change); and the wired-but-unused `TierGuard`/`RoleGuard` (intentional pre-billing scaffolding).

Migrations: none added — every fix is code-only. Verification ran against `docker-compose.test.yml` (Postgres 5433 + Redis 6380) with `prisma migrate deploy` applied. Local-only follow-up when these land on a shared branch: `docs/API_Design.md` should note the get-session throttle exemption and the onboarding rate bucket.

## Risk-audit sign-off batch (branch `fix/risk-audit-followups`, 2026-05-30/31)

Cleared three of the four "Deliberately left for sign-off" residuals from the risk-audit batch above (the wired-but-unused `TierGuard`/`RoleGuard` stays — it's intentional pre-billing scaffolding, not a defect). Each is its own commit. End-of-batch verification: api unit **20 suites / 236 tests**; api integration `users.repository` (real Postgres) **15 tests** incl. the 3 onboarding-marker specs; api e2e `devices.controller` + `ai.controller` (full app boot) **17 tests** incl. the idempotent-replay spec; api e2e `ai-fallback` **5 tests** (re-pointed at the streaming path); web jest **11 suites / 162 tests** incl. the idempotency-key store specs; `tsc --noEmit` clean for both apps.

**1. Durable onboarding-completion marker (`feat(onboarding): make the completion marker durable via User.onboardingCompletedAt`).** Residual #3 from the prior batch: the "did this user finish onboarding?" flag lived only in the Redis `onboarding:completed:{userId}` key (1-yr TTL), so a full Redis flush would resurface the first-run wizard for finished users. Replaced it with a durable `User.onboardingCompletedAt DateTime?` column (additive, nullable — existing users read as NULL = not-yet-completed, which is correct since the wizard already re-opens for anyone without a Network). New migration `20260530000000_add_user_onboarding_completed`. `UsersRepository` gains `markOnboardingComplete` (stamps `now()`) and `isOnboardingComplete` (NULL-check); `OnboardingService.markCompleted`/`isCompleted` delegate to the repo instead of Redis, and the `COMPLETED_TTL_SECONDS`/`completedKey` constants are gone. `OnboardingModule` now imports `UsersModule`. Unit spec re-pointed at the DB marker (mock `UsersRepository`), users.repository integration spec adds 3 marker tests. The wizard flow is otherwise unchanged — the `ONBOARD_002` lockout still fires only when the durable marker is set and no in-flight Redis state exists.

**2. Server-side idempotency keys for offline create-replay (`feat(api): idempotency-key replay protection on device + circuit creates`).** Residual: only circuits could duplicate on a lost-response replay (device creates are dedup'd by name-uniqueness → clean 409 give-up, but circuits have no uniqueness constraint, so a POST whose response was lost would insert a second row on replay). Added `IdempotencyInterceptor` (`apps/api/src/common/idempotency/`) — best-effort GET-then-SET on a `idempotency:{userId}:{key}` Redis key (24h TTL), user-scoped, header-driven (`Idempotency-Key`), passthrough when the header or user is absent. A key hit returns the cached response envelope without re-running the handler; a miss runs the handler and caches the result. Wired via `@UseInterceptors` on `POST /devices` and `POST /circuits` (each module provides the interceptor). Web side: `newIdempotencyKey()` in `offline-queue.ts` (crypto.randomUUID with a v4 fallback) — device/circuit stores generate the key **once** at create time and send the *same* key on the first POST and every offline replay, so a recovered queue can't duplicate. `jest.unit.config.ts` testRegex extended with `interceptor`; new interceptor unit spec (4 cases) + a devices e2e replay spec (same key + same body returns the original row, list shows exactly one device). Best-effort by design: it dedups offline replays (original and retry are never concurrent), not two genuinely-simultaneous requests sharing a key.

**3. Removed the unused HTTP `POST /v1/ai/message` endpoint (`refactor(ai): drop the dead HTTP message endpoint, WS is the only chat surface`).** AI chat is WebSocket-only (`v1:ai:message` → token stream); the HTTP `POST /v1/ai/message` had no client and only existed as tested-and-documented dead surface. Dropped the controller route, `AiService.sendMessageHttp`, and the `SendAiMessageDto`-driven HTTP specs. The shared helpers (`SendAiMessageDto`, `AiMessageResponseDto`, `buildSuccessEnvelope`, `buildFallbackEnvelope`) stay — the surviving `sendMessageStream` WS path still uses them. `ai.controller.e2e` reworked: dropped the POST-message cases, seeds a conversation via `ConversationService.appendMessages` to exercise DELETE, and adds a `GEN_002` 404 case for a missing conversation. `ai-fallback.e2e` re-pointed from `sendMessageHttp` to `sendMessageStream` (mock `adapter.stream` instead of `adapter.complete`). The controller now exposes only `GET /usage` and `DELETE /conversation/:id`.

Local-only follow-up (gitignored per CLAUDE.md): `docs/API_Design.md` should drop the `POST /v1/ai/message` row + add the `Idempotency-Key` header note on the create endpoints; `docs/DB_Schema.md` should add `User.onboardingCompletedAt`. Still open after this batch: the `TierGuard`/`RoleGuard` scaffolding (intentional, ships unused until billing lands).

## Tech-debt sign-off batch (branch `fix/tech-debt-followups`, 2026-05-31)

**Tightened `UpdatePreferencesDto.layerToggles` validation with a custom `@IsBooleanRecord()` decorator (`fix(api): validate layerToggles values are booleans, not just an object`).** The map-preferences `layerToggles` field is typed `Record<string, boolean>` but was guarded only by class-validator's `@IsObject()`, which accepts *any* non-array object — so a malformed payload like `{ ROUTER: 'yes' }` cleared the API boundary, got persisted verbatim to the `User.mapPreferences` JSON column, and was then shipped back to the map renderer (which expects booleans for its layer toggles). `@IsBoolean({ each: true })` doesn't help — its `each` form only walks arrays, not record values. Added `apps/api/src/common/validators/is-boolean-record.validator.ts`: a `registerDecorator`-based validator that accepts only a plain object (not `null`, not an array) whose every value is a `boolean` (an empty object is vacuously valid; pair with `@IsOptional()` to allow omission). Swapped `@IsObject()` → `@IsBooleanRecord()` on `layerToggles` and dropped the now-unused `IsObject` import. `jest.unit.config.ts` testRegex extended with `validator` so `*.validator.spec.ts` runs in the unit suite (mirrors the `interceptor` entry added in the prior batch). New `is-boolean-record.validator.spec.ts` exercises the validator in isolation (all-boolean record, empty object, non-boolean value, mixed boolean/non-boolean, array, primitive string, required-vs-optional null/undefined) and through the real `UpdatePreferencesDto`. Also backfilled `UsersService.getPreferences`/`updatePreferences` unit tests — the methods predate this batch (Phase 10 cross-device prefs sync) but had no service-level coverage; the `updatePreferences` test pins the write-then-re-read contract (the service returns the server-canonical re-read, not the input echo).

Verification (scoped — this is a backend validator + unit-test change, so integration/e2e/web suites are unaffected): full api `test:unit` suite green (exit 0), including the new validator spec and the added `users.service` prefs tests; `tsc --noEmit` clean for the api workspace. Code-only — no migration, and no API-contract change (the `layerToggles` shape is unchanged; only its server-side validation was tightened from "any object" to "object of booleans"). Local-only follow-up (gitignored per CLAUDE.md): none — `docs/API_Design.md` already documents `layerToggles` as `Record<string, boolean>`, which the boundary now actually enforces.

### Validate onboarding `fieldValues` are bounded strings or finite numbers (this commit, 2026-05-31)

`OnboardingTurnDto.fieldValues` (`Record<string, string | number>`) was guarded only by class-validator's `@IsObject()`, which accepts *any* non-array object — so values of any type, length, or magnitude cleared the API boundary. The onboarding state machine's `readField`/`readNumberField` (`onboarding.state-machine.ts`) already drop wrong-**typed** values (a non-string for a text field, a non-finite number for a numeric field), so the type gap was covered. What was NOT covered is **size/magnitude**: an unbounded string or a huge finite number passes `readField`/`readNumberField` untouched and then flows into `networksService.createNetwork(...)` via the `SaveNetwork` side effect — bypassing the `@MaxLength`/`@Min`/`@Max` guards on `CreateNetworkDto` that only fire on the public network endpoints, not on this internal call. So a 1 MB network name or `downMbps: 1e308` could reach the DB through onboarding.

New `apps/api/src/common/validators/is-string-or-number-record.validator.ts` exports `IsStringOrNumberRecord(opts?, validationOptions?)` (mirrors `is-boolean-record.validator.ts`): accepts only a plain object (not `null`, not an array) with ≤ `maxKeys` entries (default 50), where every value is either a `string` of length ≤ `maxStringLength` (default 1000) or a `number` with `Number.isFinite(v) && Math.abs(v) ≤ maxNumber` (default 1e9). Empty object is valid; pair with `@IsOptional()` to allow omission. `onboarding.dto.ts` now applies `@IsStringOrNumberRecord({ maxStringLength: 1000 })` (kept `@IsOptional()`) and dropped the now-unused `IsObject` import. New `is-string-or-number-record.validator.spec.ts` (19 cases) covers string+number mix, empty object, boundary lengths/magnitudes, Infinity/NaN, over-magnitude, boolean value, over-`maxKeys`, array, primitives, required-vs-optional null/undefined, plus a block driving the real `OnboardingTurnDto` (rejects `{ name: '<1001 chars>' }`, accepts `{ name: 'home', downMbps: 100 }`, accepts the DTO with `fieldValues` omitted). `import 'reflect-metadata'` at the top since the spec doesn't pull in `@nestjs/core`. The `validator` testRegex entry added in the prior batch already discovers it.

Verification (scoped — backend DTO validator + unit-test change; integration/e2e/web suites unaffected): full api `test:unit` green — **25 suites / 291 tests** (exit 0), incl. the new validator spec; `tsc --noEmit` clean for the api workspace. Code-only — no migration. Local-only follow-up (gitignored per CLAUDE.md): `docs/API_Design.md` could note the onboarding `fieldValues` bounds, though the shape (`Record<string, string | number>`) is unchanged.

### Return 400 on a malformed circuits cursor instead of 500 (this commit, 2026-05-31)

`CircuitsRepository.findWithCursor` base64-decoded and `JSON.parse`-d the untrusted `?cursor=` query param (`ListCircuitsQueryDto.cursor`, only `@IsString()`-validated) with no try/catch. A malformed cursor — non-base64, or base64 that decodes to invalid JSON — threw a raw `SyntaxError` out of the repository, which the global exception filter maps to `GEN_003 INTERNAL_ERROR` (500). A bad cursor is client input, not a server fault, so it should be a 400. Extracted the decode into a private `decodeCursor` that wraps the parse and, on failure, throws `NodeScopeException('GEN_001', 'INVALID_CURSOR', 400)` — the same guard pattern `conversation.service.ts` / `onboarding.service.ts` already use for their `JSON.parse` calls. (`GEN_001` is the existing validation/bad-request code; no new error code was invented.)

New `apps/api/src/circuits/__tests__/circuits-decode.cursor.spec.ts` drives the guard with a stub `PrismaService` (the decode runs before any DB call, so no test DB needed): a non-base64 cursor and a base64-of-non-JSON cursor each yield a `NodeScopeException` carrying a 400 and never reach `findMany`; a well-formed cursor decodes and queries normally. `jest.unit.config.ts` testRegex gains a `cursor` entry so the spec runs in the unit suite (additive — every previously-matched file still matches).

Verification: full api `test:unit` green — **26 suites / 294 tests** (exit 0), incl. the new cursor spec; `tsc --noEmit` clean for the api workspace. Code-only — no migration. (The circuits **e2e** suite needs the docker test DB from `docker-compose.test.yml`, which is down in this sandbox; the unit-level guard test above is DB-free and is the gate, alongside `tsc`.) Local-only follow-up (gitignored per CLAUDE.md): `docs/API_Design.md` §2.7 already lists `GEN_001`; the circuits list endpoint could note that a malformed cursor returns 400 `INVALID_CURSOR`.

### Backfill ClientsService.parsePlatform + NominatimAdapter unit tests (this commit, 2026-05-31)

Two untested units, no production-code change. `ClientsService.parsePlatform` (UA → platform string) and `NominatimAdapter` (the only geocoding provider) both had zero unit coverage — the clients controller and the adapter were only ever touched via e2e/onboarding paths that need the test DB or a live HTTP call.

`clients/__tests__/clients.service.spec.ts` covers every `parsePlatform` branch — windows, mac os x, linux, android, iphone/ipad/ipod, and the null fallback (unrecognized + empty UA) — exercised through the public `getClients()` (which is where `parsePlatform` is consumed), plus the `getClients` envelope (agent-unavailable message, null-vs-mapped metrics). **Notable: the branches run in source order and the first match wins, so a real-world Android UA (which contains "Linux") classifies as Linux and a real iPhone UA (which contains "Mac OS X") classifies as macOS.** That order-dependent shadowing is the current MVP heuristic's actual behavior, so each pure branch is isolated with a UA token that doesn't also hit an earlier branch, and a separate `regex precedence` block pins the real-mobile-UA shadowing as-is — making any future reordering a deliberate, test-visible change rather than a silent regression. (Initial draft asserted Android/iOS for the real UAs and failed; corrected to assert what the code does.)

`map/geocoding/__tests__/nominatim.adapter.spec.ts` mocks global `fetch`: success → mapped `{ latitude, longitude, displayName }` (with `parseFloat` of the string lat/lon), URL/header assertions (url-encoded query, `format=json`, `limit=1`, User-Agent + Accept), non-OK response → null, fetch throws → null, empty result list → null, and the rate limiter — first call doesn't wait, a back-to-back call schedules a ~1100 ms `setTimeout` (`Date.now` pinned, `setTimeout` stubbed to fire immediately so the test doesn't sleep). `import 'reflect-metadata'` since the spec doesn't pull in `@nestjs/core`. `jest.unit.config.ts` testRegex gains an `adapter` entry so `*.adapter.spec.ts` runs in the unit suite (additive).

Verification: full api `test:unit` green — **28 suites / 318 tests** (exit 0), incl. both new specs (the NominatimAdapter WARN logs in the run are the error-path tests exercising the catch/non-OK branches, not failures); `tsc --noEmit` clean for the api workspace. Test-only change. Local-only follow-up (gitignored per CLAUDE.md): none.

### Remove dead OnboardingService.loadState (this commit, 2026-05-31)

`OnboardingService` had a `private async loadState(userId)` that read+parsed the Redis wizard state with a `welcome`/`{}` fallback. It had zero callers — `handleTurn` reads `redis.get(stateKey(...))` and calls `parseState` inline (it needs the raw "is there state at all?" signal to decide the ONBOARD_002 lockout, which `loadState` would have hidden behind its fallback), and nothing else referenced it. Deleted the method; `grep -rn loadState apps/api/src` is now clean. The `PersistedState` interface and the `parseState`/`saveState` helpers it used remain in use, so nothing else changed.

Verification: `grep -rn loadState apps/api/src` → 0 hits; `onboarding.service.spec` still green (**18/18**); full api `test:unit` green (exit 0); `tsc --noEmit` clean for the api workspace. Dead-code removal only — no behavior change, no migration. Local-only follow-up (gitignored per CLAUDE.md): none.

### Fall through when the idempotency cache read fails (this commit, 2026-05-31)

`IdempotencyInterceptor.intercept` opened with an unguarded `await this.redis.get(redisKey)`. The interceptor is documented best-effort — its write-back is already fire-and-forget (`void this.redis.set(...)`) — but the initial read wasn't protected, so a Redis blip on the GET would reject and 500 the underlying create (`POST /devices`, `POST /circuits`) even though dedup is purely an optimization. Wrapped the `get` in try/catch: on error, log at `warn` and `return next.handle()` (treat as a cache miss and run the handler). The whole interceptor now degrades to a transparent no-op when Redis is unavailable, instead of taking the create down with it. Added the `Logger` import + a `private readonly logger`.

Extended `idempotency.interceptor.spec` with a case where `redis.get` rejects: the handler still runs exactly once and the call resolves with the fresh response (no throw). The WARN line that appears in the unit run for this spec is that test's logged-and-swallowed error, not a failure.

Verification: `idempotency.interceptor.spec` green (**5/5**, incl. the new cache-read-failure case); full api `test:unit` green (exit 0); `tsc --noEmit` clean for the api workspace. Code-only — no migration, no API-contract change (behavior only changes on a Redis fault, where it now degrades gracefully instead of 500-ing). Local-only follow-up (gitignored per CLAUDE.md): none.

### Validate PATCH changeset values against each entity's create-field rules (this commit, 2026-05-31)

The optimistic-concurrency PATCH endpoints (`/v1/{devices,networks,circuits,fiber-runs,device-connections}/:id`) take a changeset of `{ field, oldValue, newValue }` entries. `ConflictResolutionService.buildUpdatePayload` whitelisted `change.field` against the entity's `*_WRITABLE_FIELDS` but copied `change.newValue` — typed `unknown` and `@Allow()`'d in `ChangesetChangeDto` — **verbatim** into the Prisma `updateMany` payload, so every per-field guard the create DTOs enforce was bypassed on update. Two concrete harms across all five mutable entities: (1) **unbounded / out-of-range writes** — a PATCH could set `name`/`notes`/`floorLabel` past their `@MaxLength`, push `latitude` to 9999 (no `@IsLatitude`), `floor` outside `[-10,200]`, a malformed `macAddress`, a negative `bandwidth`, etc.; (2) **500 instead of 400 on a type mismatch** — a wrong-typed `newValue` (a string for the `Float` `latitude`, a bad enum for `category`, an array/object) reached Prisma, which doesn't coerce types and throws a `PrismaClientValidationError`; that is not an `HttpException`, so `GlobalExceptionFilter` maps it to `GEN_003 INTERNAL_ERROR` (500). Bad client input should be a 400, and bad data should never persist.

Fix: `buildUpdatePayload` gains an optional `validatorClass` param and each of the five entity services passes its existing `Create*Dto`. A new private `validateChangeValue` builds an instance carrying only the one patched field and runs class-validator's `validateSync(instance, { skipUndefinedProperties: true })` — so exactly the patched field is checked against the **same decorators the create endpoint already declares** (type, length, range, format), with zero rule duplication; the other (undefined) fields are skipped, and `@IsOptional()` fields still accept `null` to clear them. A constraint violation throws `NodeScopeException('GEN_001', …, 400)` — the existing validation/bad-request code, no new code invented — the same 400 the create path returns. Values are otherwise persisted unchanged. The param is optional, so the signature stays backward-compatible: omitting it keeps the legacy name-only-whitelist behavior (pinned by an explicit back-compat test). Every writable field of all five entities was confirmed to have a matching validated property on its Create DTO before wiring.

Verification: extended `conflict.service.spec` drives the new path through the **real `CreateDeviceDto`** — accepts a valid value and a `null` on an optional field; rejects an over-length name, a string for `latitude`, an out-of-range latitude, a bad `category` enum, a malformed `macAddress`, and a wrong-typed field inside a multi-field changeset (each asserts `GEN_001` + 400); plus the no-validator back-compat case. Targeted run green — `conflict` + all 5 entity service specs (**6 suites / 83 tests**; the entity specs mock `buildUpdatePayload`, so they're unaffected). `tsc --noEmit` clean for the api workspace. Code-only — no migration, no API-contract change (the changeset shape is unchanged; only its values are now validated to the same standard as create). Local-only follow-up (gitignored per CLAUDE.md): `docs/API_Design.md` could note that PATCH values are validated against the create-field rules and that a bad value returns 400 `GEN_001`.

### Return 400 (not 500) on a malformed `deviceId` list filter (this commit, 2026-05-31)

`GET /v1/device-connections?deviceId=` and `GET /v1/fiber-runs?deviceId=` accept an optional `deviceId` filter (`@Query('deviceId') deviceId?: string`) with no pipe and no DTO — the raw value flows into `where: { OR: [{ sourceDeviceId: deviceId }, … ] }`. Express's `qs` parser turns `?deviceId[]=a&deviceId[]=b` into an **array**, which is an invalid scalar filter, so Prisma throws a `PrismaClientValidationError` → `GlobalExceptionFilter` maps it to `GEN_003 INTERNAL_ERROR` (500). A malformed filter is client input, not a server fault.

`ConnectionsService.listConnections` and `FiberRunsService.listFiberRuns` now reject a present-but-non-UUID `deviceId` with `NodeScopeException('GEN_001', 'INVALID_DEVICE_ID', 400)` — using class-validator's `isUUID`, which also returns false for a non-string — before touching the repository; an absent filter still lists everything. Same fail-fast-on-bad-input pattern as the circuits-cursor fix, applied at the service layer where it's unit-testable. (A plain non-UUID string previously returned an empty list rather than 500; it is now a 400 too — the principled behavior a `ParseUUIDPipe` would give, and no legitimate client sends a non-UUID here.)

Verification: extended both service specs — a valid UUID passes through to the repository; an array-shaped `deviceId` and a non-UUID string each reject with `GEN_001` and never reach `findAllByUserId`; the no-filter case lists all (**connections + fiber-runs: 2 suites / 23 tests** green). `tsc --noEmit` clean for the api workspace. Code-only — no migration. Local-only follow-up (gitignored per CLAUDE.md): `docs/API_Design.md` could note the `deviceId` filter must be a UUID (400 `INVALID_DEVICE_ID` otherwise).

### Bound websocket metric payload sizes (this commit, 2026-05-31)

`DataSourcesService.parseRawPayload` parses the browser-collector metric payload that arrives over the `v1:metrics:submit` WebSocket event. WebSocket handlers are **not** covered by the global `ValidationPipe`, so this method is the only boundary — and it type-guarded each field (dropping wrong-typed values) but applied **no magnitude or length bound**: `bandwidthDown`/`bandwidthUp`/`latency` accepted any `number` (including `NaN`/`Infinity`, since `typeof NaN === 'number'`, and `1e308`), and `connectionQuality`/`deviceId`/`tag` accepted any-length string. An authenticated socket could write `{ tag: '<10 MB string>' }` or `{ bandwidthDown: 1e308 }` straight into the `DeviceMetric` hypertable.

Replaced the bare `typeof` checks with two type-guards: `isBoundedMetricNumber` (`typeof === 'number'` **and** `Number.isFinite` **and** `Math.abs(v) ≤ 1e9`) and `isBoundedMetricString` (`typeof === 'string'` **and** `length ≤ 256`). Out-of-bound values are dropped exactly like the wrong-typed ones already were (best-effort ingestion — the WS handler returns no error), so a malformed field is simply omitted (→ `null`) rather than throwing or persisting garbage. The finite check also closes the pre-existing `NaN`/`Infinity` gap. Bounds are generous (1e9 covers any real bandwidth/latency reading; 256 covers any quality/tag token).

Verification: extended `data-sources.service.spec` — drops `Infinity`/`NaN`, drops an over-magnitude `1e308`, accepts a large-but-bounded `1_000_000`, and drops over-length `connectionQuality`/`tag` while keeping a valid sibling field (**1 suite / 19 tests** green). `tsc --noEmit` clean for the api workspace. Code-only — no migration, no API-contract change (valid payloads are unaffected). Local-only follow-up (gitignored per CLAUDE.md): none.
