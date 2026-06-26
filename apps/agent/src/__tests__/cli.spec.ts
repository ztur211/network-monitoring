import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseArgs, runCli, nonOverlapping, AGENT_VERSION } from '../cli.js';
import type { CliDeps } from '../cli.js';

describe('nonOverlapping', () => {
  it('skips a tick while the previous cycle is still running, then resumes', async () => {
    let resolveFirst!: () => void;
    const cycle = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveFirst = r; }))
      .mockImplementation(() => Promise.resolve());
    const tick = nonOverlapping(cycle);

    const first = tick(); // starts the (pending) first cycle
    void tick();          // fires while the first is in flight → skipped
    expect(cycle).toHaveBeenCalledTimes(1);

    resolveFirst();       // first cycle completes
    await first;          // its finally clears the running flag
    await tick();         // now runs again (resolves immediately)
    expect(cycle).toHaveBeenCalledTimes(2);
  });

  it('clears the running flag even when a cycle rejects', async () => {
    const cycle = vi.fn().mockRejectedValue(new Error('boom'));
    const tick = nonOverlapping(cycle);
    await expect(tick()).rejects.toThrow('boom');
    await expect(tick()).rejects.toThrow('boom'); // not stuck "running"
    expect(cycle).toHaveBeenCalledTimes(2);
  });
});

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
    // Fix 2: assert saveCredentials was called WITH the mocked enroll's return value
    expect(deps.saveCredentials).toHaveBeenCalledWith(
      expect.any(String),
      { agentId: 'agent-1', token: 'tok-abc' },
    );
    expect(exitCode).toBe(0);
  });

  it('enroll without --code exits 1 and logs error via injected log', async () => {
    await runCli(['enroll'], deps);
    expect(exitCode).toBe(1);
    expect(deps.enroll).not.toHaveBeenCalled();
    // Fix 3: error message must go through injected log (not console.error)
    expect(logs).toContain('enroll requires --code');
  });

  it('no args calls startDaemon', async () => {
    await runCli([], deps);
    expect(deps.startDaemon).toHaveBeenCalledOnce();
  });
});
