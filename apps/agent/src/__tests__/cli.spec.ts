import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseArgs, runCli, AGENT_VERSION } from '../cli.js';
import type { CliDeps } from '../cli.js';

describe('parseArgs', () => {
  it('returns version command for --version', () => {
    expect(parseArgs(['--version'])).toEqual({ command: 'version', options: {} });
  });

  it('returns version command for -v', () => {
    expect(parseArgs(['-v'])).toEqual({ command: 'version', options: {} });
  });

  it('returns enroll command with code and url', () => {
    expect(parseArgs(['enroll', '--code', 'abc', '--url', 'http://x'])).toEqual({
      command: 'enroll',
      options: { code: 'abc', url: 'http://x' },
    });
  });

  it('returns enroll command with only code', () => {
    expect(parseArgs(['enroll', '--code', 'XYZ'])).toEqual({
      command: 'enroll',
      options: { code: 'XYZ' },
    });
  });

  it('returns run command for no args', () => {
    expect(parseArgs([])).toEqual({ command: 'run', options: {} });
  });

  it('returns run command for unrecognised args', () => {
    expect(parseArgs(['daemon'])).toEqual({ command: 'run', options: {} });
  });
});

describe('runCli', () => {
  let logs: string[];
  let exitCode: number | undefined;
  let deps: CliDeps;

  beforeEach(() => {
    logs = [];
    exitCode = undefined;
    deps = {
      log: (msg) => { logs.push(msg); },
      exit: (code) => { exitCode = code; return undefined as never; },
      enroll: vi.fn().mockResolvedValue({ agentId: 'agent-1', token: 'tok-abc' }),
      saveCredentials: vi.fn(),
      startDaemon: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('--version prints version string and exits 0', async () => {
    await runCli(['--version'], deps);
    expect(logs).toContain(AGENT_VERSION);
    expect(exitCode).toBe(0);
  });

  it('AGENT_VERSION is a non-empty string', () => {
    expect(typeof AGENT_VERSION).toBe('string');
    expect(AGENT_VERSION.length).toBeGreaterThan(0);
  });

  it('enroll --code abc --url http://x calls enroll and saveCredentials then exits 0', async () => {
    await runCli(['enroll', '--code', 'abc', '--url', 'http://x'], deps);
    expect(deps.enroll).toHaveBeenCalledOnce();
    const call = vi.mocked(deps.enroll!).mock.calls[0][0];
    expect(call.code).toBe('abc');
    expect(call.apiUrl).toBe('http://x');
    expect(deps.saveCredentials).toHaveBeenCalledOnce();
    expect(exitCode).toBe(0);
  });

  it('enroll without --code exits 1', async () => {
    await runCli(['enroll'], deps);
    expect(exitCode).toBe(1);
    expect(deps.enroll).not.toHaveBeenCalled();
  });

  it('no args calls startDaemon', async () => {
    await runCli([], deps);
    expect(deps.startDaemon).toHaveBeenCalledOnce();
  });
});
