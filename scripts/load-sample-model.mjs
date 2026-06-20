#!/usr/bin/env node
/*
 * load-sample-model.mjs — load a REAL IFC building into the seeded "Main Building".
 *
 * Why: `prisma db seed` only attaches a ~62-byte placeholder IFC (a valid header
 * with no geometry), so the 3D BIM viewer renders an empty scene. This script
 * uploads a real model through the supported API (upload version -> activate),
 * exactly as the desktop app does, so the viewer shows an actual building.
 *
 * Usage:
 *   node scripts/load-sample-model.mjs                 # downloads the sample AC20-FZK-Haus.ifc
 *   node scripts/load-sample-model.mjs ./my-model.ifc  # loads your own IFC instead
 *
 * Env (optional; defaults match .env.example):
 *   API_URL        API base    (default http://localhost:3000; also reads EXPO_PUBLIC_API_URL)
 *   WEB_ORIGIN     CORS origin (default http://localhost:8081; also reads FRONTEND_URL)
 *   SEED_EMAIL     login email (default owner@acme.test)
 *   SEED_PASSWORD  login pass   (default devpassword123)
 *   BUILDING_NAME  target       (default "Main Building")
 */
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';

const API = (process.env.API_URL || process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const ORIGIN = process.env.WEB_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:8081';
const EMAIL = process.env.SEED_EMAIL || 'owner@acme.test';
const PASSWORD = process.env.SEED_PASSWORD || 'devpassword123';
const BUILDING_NAME = process.env.BUILDING_NAME || 'Main Building';

// A small, well-formed public IFC (the "FZK Haus" test house, ~2.5 MB) from the
// ThatOpen/engine_web-ifc test corpus — the same IFC engine the viewer uses.
const SAMPLE_URL =
  'https://raw.githubusercontent.com/ThatOpen/engine_web-ifc/main/tests/ifcfiles/public/AC20-FZK-Haus.ifc';

const mb = (n) => (n / 1e6).toFixed(2) + ' MB';
const die = (msg) => { console.error('\n✖ ' + msg); process.exit(1); };
const ok = (msg) => console.log('✔ ' + msg);

async function resolveSample() {
  const cache = join(tmpdir(), 'nodescope-samples', 'AC20-FZK-Haus.ifc');
  try {
    const s = await stat(cache);
    if (s.size > 0) { ok(`Using cached sample IFC (${mb(s.size)}) at ${cache}`); return cache; }
  } catch { /* not cached yet */ }
  console.log('↓ Downloading sample model (AC20-FZK-Haus.ifc) …');
  const res = await fetch(SAMPLE_URL).catch((e) => die(`download failed: ${e.message} (need internet for the first run)`));
  if (!res.ok) die(`download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(cache), { recursive: true });
  await writeFile(cache, buf);
  ok(`Downloaded ${mb(buf.length)} → ${cache}`);
  return cache;
}

function cookieFrom(setCookie) {
  return setCookie
    .split(',')
    .map((s) => s.split(';')[0].trim())
    .filter((s) => s.includes('='))
    .join('; ');
}

async function main() {
  const filePath = process.argv[2] || (await resolveSample());
  const bytes = await readFile(filePath).catch(() => die(`cannot read IFC file: ${filePath}`));
  const fileName = basename(filePath);
  if (!bytes.subarray(0, 13).toString('latin1').startsWith('ISO-10303-21')) {
    die(`${fileName} does not look like an IFC (missing ISO-10303-21 header)`);
  }
  ok(`IFC to upload: ${fileName} (${mb(bytes.length)})`);

  // 1) Authenticate as the seeded org owner -> better-auth session cookie.
  const login = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).catch((e) => die(`API unreachable at ${API} (${e.message}). Is \`npm run dev:api\` running?`));
  const setCookie = login.headers.get('set-cookie');
  if (!login.ok || !setCookie) die(`login failed: HTTP ${login.status} for ${EMAIL}. Did you run \`npm run db:seed\`?`);
  const cookie = cookieFrom(setCookie);
  ok(`Logged in as ${EMAIL}`);

  // 2) Find the seeded building's propertyId.
  const propsRes = await fetch(`${API}/api/v1/properties`, { headers: { Cookie: cookie, Origin: ORIGIN } });
  const propsJson = await propsRes.json().catch(() => ({}));
  if (!propsRes.ok) die(`GET /api/v1/properties failed: HTTP ${propsRes.status}`);
  const building = (propsJson.data || []).find((p) => p.name === BUILDING_NAME && p.type === 'BUILDING');
  if (!building) die(`building "${BUILDING_NAME}" not found. Did you run \`npm run db:seed\`?`);
  ok(`Found building "${BUILDING_NAME}" (${building.id})`);

  // 3) Upload the IFC as a new version. The endpoint reads the RAW request body
  //    (application/octet-stream) — not multipart — same as the desktop client.
  const upRes = await fetch(
    `${API}/api/v1/buildings/${building.id}/model/versions?fileName=${encodeURIComponent(fileName)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Cookie: cookie, Origin: ORIGIN }, body: bytes },
  );
  const upJson = await upRes.json().catch(() => ({}));
  if (!upRes.ok) die(`upload failed: HTTP ${upRes.status} ${JSON.stringify(upJson)}`);
  const version = upJson.data;
  ok(`Uploaded version #${version.versionNumber} (${version.sizeBytes} bytes, id ${version.id})`);

  // 4) Activate it as the live model.
  const actRes = await fetch(`${API}/api/v1/buildings/${building.id}/model/active`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
    body: JSON.stringify({ versionId: version.id }),
  });
  if (!actRes.ok) die(`activate failed: HTTP ${actRes.status} ${await actRes.text()}`);
  ok(`Activated version #${version.versionNumber} as the live model`);

  console.log(`\n🏠 Done. "${BUILDING_NAME}" now serves real geometry — open the desktop app (or web) to view it.`);
}

main().catch((e) => die(e?.stack || String(e)));
