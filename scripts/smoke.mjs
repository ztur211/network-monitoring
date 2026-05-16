#!/usr/bin/env node
// Post-deploy smoke test for NodeScope.
//
// Run after a deploy completes to catch obvious breakage that App Platform's
// own health check would miss. Exits 0 on success, 1 on any failed check.
//
// Usage:
//   node scripts/smoke.mjs <API_URL> <WEB_URL>
//   node scripts/smoke.mjs https://api.nodescope.io https://app.nodescope.io
//
// Or via env vars:
//   API_URL=https://... WEB_URL=https://... node scripts/smoke.mjs

const API_URL = (process.argv[2] ?? process.env.API_URL ?? '').replace(/\/$/, '');
const WEB_URL = (process.argv[3] ?? process.env.WEB_URL ?? '').replace(/\/$/, '');

if (!API_URL || !WEB_URL) {
  console.error('Usage: node scripts/smoke.mjs <API_URL> <WEB_URL>');
  console.error('   or: API_URL=... WEB_URL=... node scripts/smoke.mjs');
  process.exit(2);
}

const REQUEST_TIMEOUT_MS = 10_000;
const HEALTH_RETRIES = 6;          // 6 × 5s = 30s of grace for cold-start
const HEALTH_RETRY_DELAY_MS = 5_000;

const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`);
}

function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name}  (${detail})`);
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkApiHealth() {
  const name = 'API /api/health (with retry)';
  for (let attempt = 1; attempt <= HEALTH_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(`${API_URL}/api/health`);
      if (res.status === 200) {
        const body = await res.json();
        if (body.status === 'ok' || body.status === 'degraded') {
          pass(name, `attempt ${attempt}, status=${body.status}`);
          return;
        }
        fail(name, `unexpected body.status=${body.status}`);
        return;
      }
      if (attempt < HEALTH_RETRIES) {
        console.log(`...  ${name}  attempt ${attempt}: HTTP ${res.status}, retrying in ${HEALTH_RETRY_DELAY_MS}ms`);
        await sleep(HEALTH_RETRY_DELAY_MS);
        continue;
      }
      fail(name, `HTTP ${res.status} after ${HEALTH_RETRIES} attempts`);
    } catch (err) {
      if (attempt < HEALTH_RETRIES) {
        console.log(`...  ${name}  attempt ${attempt}: ${err.message}, retrying`);
        await sleep(HEALTH_RETRY_DELAY_MS);
        continue;
      }
      fail(name, `${err.message} after ${HEALTH_RETRIES} attempts`);
    }
  }
}

async function checkApiUnauthenticatedSession() {
  const name = 'API /api/auth/get-session (unauthenticated)';
  try {
    const res = await fetchWithTimeout(`${API_URL}/api/auth/get-session`);
    if (res.status !== 200) {
      fail(name, `HTTP ${res.status}, expected 200`);
      return;
    }
    const body = await res.json();
    // Better Auth returns null for both fields when no session cookie is sent.
    // Accept either explicit null or an empty object body — both indicate
    // "no session" and confirm the endpoint is reachable without crashing.
    if (body === null || (body.session == null && body.user == null)) {
      pass(name, 'returns empty session as expected');
      return;
    }
    fail(name, `unexpected body: ${JSON.stringify(body).slice(0, 100)}`);
  } catch (err) {
    fail(name, err.message);
  }
}

async function checkCorsPreflight() {
  const name = 'API CORS preflight (Origin=WEB_URL)';
  try {
    const res = await fetchWithTimeout(`${API_URL}/api/v1/devices`, {
      method: 'OPTIONS',
      headers: {
        'Origin': WEB_URL,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const allowCreds = res.headers.get('access-control-allow-credentials');
    if (allowOrigin !== WEB_URL) {
      fail(name, `Access-Control-Allow-Origin="${allowOrigin}", expected "${WEB_URL}"`);
      return;
    }
    if (allowCreds !== 'true') {
      fail(name, `Access-Control-Allow-Credentials="${allowCreds}", expected "true"`);
      return;
    }
    pass(name, `echoes origin, allows credentials`);
  } catch (err) {
    fail(name, err.message);
  }
}

async function checkWebRoot() {
  const name = 'Web / (index.html)';
  try {
    const res = await fetchWithTimeout(`${WEB_URL}/`);
    if (res.status !== 200) {
      fail(name, `HTTP ${res.status}`);
      return;
    }
    const body = await res.text();
    if (!/<html[\s>]/i.test(body) || !body.includes('NodeScope')) {
      fail(name, 'response did not look like the NodeScope index.html');
      return;
    }
    pass(name, `${body.length} bytes, contains <html> + "NodeScope"`);
  } catch (err) {
    fail(name, err.message);
  }
}

async function checkWebCatchall() {
  const name = 'Web /__catchall_smoke (SPA fallback)';
  try {
    const res = await fetchWithTimeout(`${WEB_URL}/__catchall_smoke`);
    // Static-site catchall_document returns 200 with index.html for any
    // unknown path so expo-router can handle it client-side.
    if (res.status !== 200) {
      fail(name, `HTTP ${res.status}, expected 200 from catchall`);
      return;
    }
    const body = await res.text();
    if (!/<html[\s>]/i.test(body)) {
      fail(name, 'catchall did not return HTML');
      return;
    }
    pass(name, 'unknown path returns SPA shell');
  } catch (err) {
    fail(name, err.message);
  }
}

async function checkSocketIoHandshake() {
  const name = 'API Socket.io handshake';
  try {
    const res = await fetchWithTimeout(
      `${API_URL}/socket.io/?EIO=4&transport=polling`,
      { headers: { 'Origin': WEB_URL } },
    );
    if (res.status !== 200) {
      fail(name, `HTTP ${res.status}, expected 200`);
      return;
    }
    const body = await res.text();
    // Socket.io engine.io polling response begins with a packet length prefix
    // followed by JSON: '0{"sid":"...","upgrades":["websocket"],...}'.
    // We accept any response that mentions "sid" — the auth gate happens on
    // the upgraded socket, not the handshake itself.
    if (!body.includes('sid')) {
      fail(name, `handshake body missing sid: ${body.slice(0, 80)}`);
      return;
    }
    pass(name, 'handshake returns sid');
  } catch (err) {
    fail(name, err.message);
  }
}

async function main() {
  console.log(`Smoke test against:`);
  console.log(`  API: ${API_URL}`);
  console.log(`  Web: ${WEB_URL}`);
  console.log('');

  // Health first (with retry — gates everything else; if the API isn't up,
  // the other checks will fail noisily without adding signal).
  await checkApiHealth();
  if (!results[results.length - 1].ok) {
    summarize();
    process.exit(1);
  }

  await checkApiUnauthenticatedSession();
  await checkCorsPreflight();
  await checkSocketIoHandshake();
  await checkWebRoot();
  await checkWebCatchall();

  summarize();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

function summarize() {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log('');
  console.log(`Summary: ${passed} passed, ${failed} failed, ${results.length} total`);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
