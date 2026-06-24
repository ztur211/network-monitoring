#!/usr/bin/env node
/*
 * load-large-sample-model.mjs — load a LARGE public IFC to benchmark geometry merging.
 *
 * Same upload→activate flow as load-sample-model.mjs; only the default model differs.
 * Default: the Schependomlaan model (~62 MB, IFC2x3, thousands of elements) — a well-known public
 * BIM dataset (design model by ROOT bv, gathered in S. van Schaijk's TU/e thesis; openBIMstandards),
 * mirrored as a normal (non-LFS) file in the ibpsa/project1-wp-2-2-bim repo. Override with a path:
 *   node scripts/load-large-sample-model.mjs ./my-big-model.ifc
 *
 * Env (optional; defaults match .env.example): API_URL, WEB_ORIGIN, SEED_EMAIL,
 *   SEED_PASSWORD, BUILDING_NAME — identical to load-sample-model.mjs.
 */
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';

const API = (process.env.API_URL || process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const ORIGIN = process.env.WEB_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:8081';
const EMAIL = process.env.SEED_EMAIL || 'owner@acme.test';
const PASSWORD = process.env.SEED_PASSWORD || 'devpassword123';
const BUILDING_NAME = process.env.BUILDING_NAME || 'Main Building';

// Schependomlaan — a large public IFC (~62 MB, non-LFS) mirrored in ibpsa/project1-wp-2-2-bim.
// The raw endpoint returns the actual bytes. If it ever 404s/moves, substitute another large
// public IFC (e.g. from openBIMstandards/DataSetSchependomlaan) and update both constants.
const SAMPLE_NAME = 'Schependomlaan.ifc';
const SAMPLE_URL =
  'https://raw.githubusercontent.com/ibpsa/project1-wp-2-2-bim/master/IFC_Files/MISC/Schependomlaan.ifc';

const mb = (n) => (n / 1e6).toFixed(2) + ' MB';
const die = (msg) => { console.error('\n✖ ' + msg); process.exit(1); };
const ok = (msg) => console.log('✔ ' + msg);

async function resolveSample() {
  const cache = join(tmpdir(), 'nodescope-samples', SAMPLE_NAME);
  try {
    const s = await stat(cache);
    if (s.size > 0) { ok(`Using cached large IFC (${mb(s.size)}) at ${cache}`); return cache; }
  } catch { /* not cached */ }
  console.log(`↓ Downloading large model (${SAMPLE_NAME}) …`);
  const res = await fetch(SAMPLE_URL).catch((e) => die(`download failed: ${e.message} (need internet for the first run)`));
  if (!res.ok) die(`download failed: HTTP ${res.status} for ${SAMPLE_URL}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(cache), { recursive: true });
  await writeFile(cache, buf);
  ok(`Downloaded ${mb(buf.length)} → ${cache}`);
  return cache;
}

function cookieFrom(setCookie) {
  return setCookie.split(',').map((s) => s.split(';')[0].trim()).filter((s) => s.includes('=')).join('; ');
}

async function main() {
  const filePath = process.argv[2] || (await resolveSample());
  const bytes = await readFile(filePath).catch(() => die(`cannot read IFC file: ${filePath}`));
  const fileName = basename(filePath);
  if (!bytes.subarray(0, 13).toString('latin1').startsWith('ISO-10303-21')) {
    die(`${fileName} does not look like an IFC (missing ISO-10303-21 header)`);
  }
  ok(`IFC to upload: ${fileName} (${mb(bytes.length)})`);

  const login = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).catch((e) => die(`API unreachable at ${API} (${e.message}). Is \`npm run dev:api\` running?`));
  const setCookie = login.headers.get('set-cookie');
  if (!login.ok || !setCookie) die(`login failed: HTTP ${login.status} for ${EMAIL}. Did you run \`npm run db:seed\`?`);
  const cookie = cookieFrom(setCookie);
  ok(`Logged in as ${EMAIL}`);

  const propsRes = await fetch(`${API}/api/v1/properties`, { headers: { Cookie: cookie, Origin: ORIGIN } });
  const propsJson = await propsRes.json().catch(() => ({}));
  if (!propsRes.ok) die(`GET /api/v1/properties failed: HTTP ${propsRes.status}`);
  const building = (propsJson.data || []).find((p) => p.name === BUILDING_NAME && p.type === 'BUILDING');
  if (!building) die(`building "${BUILDING_NAME}" not found. Did you run \`npm run db:seed\`?`);
  ok(`Found building "${BUILDING_NAME}" (${building.id})`);

  const upRes = await fetch(
    `${API}/api/v1/buildings/${building.id}/model/versions?fileName=${encodeURIComponent(fileName)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Cookie: cookie, Origin: ORIGIN }, body: bytes },
  );
  const upJson = await upRes.json().catch(() => ({}));
  if (!upRes.ok) die(`upload failed: HTTP ${upRes.status} ${JSON.stringify(upJson)}`);
  const version = upJson.data;
  ok(`Uploaded version #${version.versionNumber} (${version.sizeBytes} bytes, id ${version.id})`);

  const actRes = await fetch(`${API}/api/v1/buildings/${building.id}/model/active`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
    body: JSON.stringify({ versionId: version.id }),
  });
  if (!actRes.ok) die(`activate failed: HTTP ${actRes.status} ${await actRes.text()}`);
  ok(`Activated version #${version.versionNumber} as the live model`);
  console.log(`\n🏢 Done. "${BUILDING_NAME}" now serves the large model — open the desktop app to benchmark.`);
}

main().catch((e) => die(e?.stack || String(e)));
