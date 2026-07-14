import { createServer, Server } from 'node:net';
import type { execFile as NodeExecFile } from 'node:child_process';
import {
  tcpProbe,
  probeDevice,
  icmpProbe,
  resetIcmpAvailability,
  setIcmpUnavailableHandler,
} from '../index';

const listen = (): Promise<{ srv: Server; port: number }> =>
  new Promise((resolve) => {
    const srv = createServer().listen(0, () => {
      resolve({ srv, port: (srv.address() as { port: number }).port });
    });
  });

describe('probe', () => {
  it('tcpProbe ok to a listening port, fail to a closed one', async () => {
    const { srv, port } = await listen();
    const ok = await tcpProbe('127.0.0.1', port, 1000);
    expect(ok.ok).toBe(true);
    expect(ok.latencyMs).toBeGreaterThanOrEqual(0);
    await new Promise((r) => srv.close(r));
    const fail = await tcpProbe('127.0.0.1', port, 500);
    expect(fail.ok).toBe(false);
  });

  it('probeDevice falls back to TCP when ICMP is disabled', async () => {
    const { srv, port } = await listen();
    const r = await probeDevice('127.0.0.1', { icmpEnabled: false, ports: [port], timeoutMs: 1000 });
    expect(r.ok).toBe(true);
    await new Promise((res) => srv.close(res));
  });

  it('probeDevice reports unreachable when no port connects', async () => {
    const { srv, port } = await listen();
    await new Promise((r) => srv.close(r)); // close so the port is dead
    const r = await probeDevice('127.0.0.1', { icmpEnabled: false, ports: [port], timeoutMs: 400 });
    expect(r.ok).toBe(false);
  });

  it('icmpProbe parses latency from ping output on success', async () => {
    const exec = ((_f: string, _a: string[], _o: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
      cb(null, '64 bytes from 10.0.0.1: icmp_seq=1 ttl=64 time=12.3 ms', '');
      return {} as never;
    }) as unknown as typeof NodeExecFile;
    expect(await icmpProbe('10.0.0.1', 2000, exec)).toEqual({ ok: true, latencyMs: 12.3 });
  });

  it('icmpProbe passes a hard timeout so a hung ping cannot leave the promise unsettled', async () => {
    let capturedTimeout: number | undefined;
    // Simulate execFile's own timeout firing: it kills the child and calls back with an error.
    const exec = ((_f: string, _a: string[], opts: { timeout?: number }, cb: (e: Error) => void) => {
      capturedTimeout = opts.timeout;
      setTimeout(() => cb(Object.assign(new Error('timeout'), { killed: true })), 0);
      return {} as never;
    }) as unknown as typeof NodeExecFile;

    const r = await icmpProbe('10.0.0.1', 2000, exec);
    expect(r).toEqual({ ok: false });
    expect(capturedTimeout).toBeGreaterThan(0); // the fix: a positive kill-timeout is set
  });

  /**
   * The API image shipped without a `ping` binary (node:*-slim has none), so execFile failed
   * with ENOENT on every probe and we reported it as `{ok: false}` - i.e. "the device is down".
   * A broken deployment read as a fleet-wide outage, and every ICMP-only device (no 443/80/22
   * open) was a false alarm. A missing binary must be loud, and must not be mistaken for a
   * dead host.
   */
  describe('missing ping binary', () => {
    const enoent = (() => Object.assign(new Error('spawn ping ENOENT'), { code: 'ENOENT' }))();
    const execEnoent = ((_f: string, _a: string[], _o: unknown, cb: (e: Error) => void) => {
      cb(enoent);
      return {} as never;
    }) as unknown as typeof NodeExecFile;

    beforeEach(() => resetIcmpAvailability());
    afterEach(() => {
      resetIcmpAvailability();
      setIcmpUnavailableHandler((m) => console.error(`[probe] ${m}`));
    });

    it('flags ICMP as unavailable rather than silently reporting the host down', async () => {
      setIcmpUnavailableHandler(() => {});
      const r = await icmpProbe('10.0.0.1', 2000, execEnoent);
      expect(r).toEqual({ ok: false, icmpUnavailable: true });
    });

    it('reports the misconfiguration exactly once, not once per probe', async () => {
      const messages: string[] = [];
      setIcmpUnavailableHandler((m) => messages.push(m));

      await icmpProbe('10.0.0.1', 2000, execEnoent);
      await icmpProbe('10.0.0.2', 2000, execEnoent);
      await icmpProbe('10.0.0.3', 2000, execEnoent);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('iputils-ping');
    });

    it('stops spawning a doomed child process once ICMP is known to be impossible', async () => {
      setIcmpUnavailableHandler(() => {});
      let spawns = 0;
      const counting = ((_f: string, _a: string[], _o: unknown, cb: (e: Error) => void) => {
        spawns++;
        cb(enoent);
        return {} as never;
      }) as unknown as typeof NodeExecFile;

      for (let i = 0; i < 50; i++) await icmpProbe(`10.0.0.${i}`, 2000, counting);

      // One probe learns ping is missing; the other 49 must not pay for a child process that
      // can only fail. At 20 devices x every cycle, that spawn storm is not free.
      expect(spawns).toBe(1);
    });

    it('still falls back to TCP, so a device with an open port is correctly UP', async () => {
      setIcmpUnavailableHandler(() => {});
      await icmpProbe('10.0.0.1', 2000, execEnoent); // latch unavailable

      const { srv, port } = await listen();
      const r = await probeDevice('127.0.0.1', { icmpEnabled: true, ports: [port], timeoutMs: 1000 });
      expect(r.ok).toBe(true);
      await new Promise((res) => srv.close(res));
    });
  });
});
