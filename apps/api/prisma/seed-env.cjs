/*
 * Preloaded (via `ts-node -r`) BEFORE prisma/seed.ts runs.
 *
 * seed.ts imports ../src/auth/better-auth.config, which reads process.env at
 * module-load time — so a dotenv call inside seed.ts would run too late (ES
 * imports execute first). Preloading here guarantees the monorepo-root .env is
 * loaded before any of seed.ts's imports evaluate.
 *
 * The path is resolved from this file's location (not the cwd), so it works no
 * matter where `prisma db seed` is invoked from. dotenv does not override
 * variables already present in the environment, so exported vars still win.
 */
const { resolve } = require('node:path');
require('dotenv').config({ path: resolve(__dirname, '../../../.env') });
