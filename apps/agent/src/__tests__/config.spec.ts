import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../config.js';

describe('loadConfig', () => {
  it('reads a config file and applies env overrides + defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-'));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ apiUrl: 'http://host/api', probeIntervalMs: 15000 }));
    const cfg = loadConfig({ configPath: join(dir, 'config.json'), env: { NODESCOPE_AGENT_CONCURRENCY: '8' } });
    expect(cfg.apiUrl).toBe('http://host/api');
    expect(cfg.probeIntervalMs).toBe(15000);
    expect(cfg.concurrency).toBe(8);          // env override
    expect(cfg.ports).toEqual([443, 80, 22]); // default
    expect(cfg.syncIntervalMs).toBe(300000);  // default
  });
});
