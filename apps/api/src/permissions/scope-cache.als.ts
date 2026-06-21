import { AsyncLocalStorage } from 'node:async_hooks';

// Per-request memo for PermissionsService.scopePropertyIds (mirrors auditAls). The same
// (org, member) scope is recomputed on every read and several times per write — inScope is
// called in loops (assertNetworkFullCoverage / assertWithinGrantorScope / team membership),
// and each call is a roots query + a per-root recursive-CTE fan-out. Caching the Promise
// for the request lifetime collapses that redundant work.
//
// Request-scoped, so a later request can never be served a stale scope. An absent store
// (no middleware, or a non-HTTP caller) simply means no caching — correct by fall-through.
export const scopeCacheAls = new AsyncLocalStorage<Map<string, Promise<string[]>>>();
