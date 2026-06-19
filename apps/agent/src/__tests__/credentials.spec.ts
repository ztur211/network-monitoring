import { describe, it, expect } from 'vitest';
import { mkdtempSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveCredentials, loadCredentials } from '../credentials.js';

describe('credentials', () => {
  it('persists and reloads, mode 0600', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'cred-')), 'credentials.json');
    saveCredentials(path, { agentId: 'a', token: 't' });
    expect(loadCredentials(path)).toEqual({ agentId: 'a', token: 't' });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadCredentials(join(tmpdir(), 'nope.json'))).toBeNull();
  });
});
