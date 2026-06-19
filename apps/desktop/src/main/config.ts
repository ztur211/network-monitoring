import { app } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const settingsFile = () => join(app.getPath('userData'), 'settings.json');

// Resolve the API base URL: a persisted Settings override wins, else build-time env, else the dev default.
// The NestJS API serves under the global `/api` prefix; AuthFlow appends `/v1/desktop-auth/...`.
export function getApiUrl(): string {
  try {
    const s = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    if (typeof s.apiUrl === 'string' && s.apiUrl) return s.apiUrl;
  } catch {
    /* no/invalid settings file — fall through to env/default */
  }
  return process.env.VITE_API_URL ?? 'http://localhost:3000/api';
}

export function setApiUrl(url: string): void {
  writeFileSync(settingsFile(), JSON.stringify({ apiUrl: url }));
}
