import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Credentials { agentId: string; token: string; }

export function saveCredentials(path: string, c: Credentials): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(c), { mode: 0o600 });
}
export function loadCredentials(path: string): Credentials | null {
  try { return JSON.parse(readFileSync(path, 'utf8')) as Credentials; } catch { return null; }
}
