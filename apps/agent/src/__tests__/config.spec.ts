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

  it('returns all defaults (no throw) when config file contains null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-'));
    writeFileSync(join(dir, 'config.json'), 'null');
    const cfg = loadConfig({ configPath: join(dir, 'config.json'), env: {} });
    expect(cfg.apiUrl).toBe('http://localhost:3000/api');
    expect(cfg.concurrency).toBe(20);
    expect(cfg.ports).toEqual([443, 80, 22]);
    expect(cfg.icmpEnabled).toBe(true);
  });

  it('returns all defaults (no throw) when config file contains an array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-'));
    writeFileSync(join(dir, 'config.json'), '[]');
    const cfg = loadConfig({ configPath: join(dir, 'config.json'), env: {} });
    expect(cfg.apiUrl).toBe('http://localhost:3000/api');
    expect(cfg.concurrency).toBe(20);
    expect(cfg.syncIntervalMs).toBe(300000);
  });

  it('uses default concurrency (20) when NODESCOPE_AGENT_CONCURRENCY is empty string', () => {
    const cfg = loadConfig({ env: { NODESCOPE_AGENT_CONCURRENCY: '' } });
    expect(cfg.concurrency).toBe(20);
  });

  it('reads icmpEnabled: false from config file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-'));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ icmpEnabled: false }));
    const cfg = loadConfig({ configPath: join(dir, 'config.json'), env: {} });
    expect(cfg.icmpEnabled).toBe(false);
  });

  it('env NODESCOPE_AGENT_API_URL overrides file-set apiUrl', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-'));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ apiUrl: 'http://file-host/api' }));
    const cfg = loadConfig({ configPath: join(dir, 'config.json'), env: { NODESCOPE_AGENT_API_URL: 'http://env-host/api' } });
    expect(cfg.apiUrl).toBe('http://env-host/api');
  });

  it('NODESCOPE_AGENT_PORTS parses comma-separated list to number array', () => {
    const cfg = loadConfig({ env: { NODESCOPE_AGENT_PORTS: '8080,443' } });
    expect(cfg.ports).toEqual([8080, 443]);
  });
});
