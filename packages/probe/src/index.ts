import { createConnection } from 'node:net';
import { execFile } from 'node:child_process';

export interface ProbeResult {
  ok: boolean;
  latencyMs?: number;
}

/** TCP-connect reachability: a completed handshake = reachable. No data is sent. */
export function tcpProbe(ip: string, port: number, timeoutMs: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const sock = createConnection({ host: ip, port });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok ? { ok: true, latencyMs: performance.now() - start } : { ok: false });
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

/**
 * ICMP via the system `ping` (spawned, so the node process needs no NET_RAW). Linux
 * flags: -c 1 (one echo), -W <seconds> (per-reply timeout).
 */
export function icmpProbe(ip: string, timeoutMs: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    execFile(
      'ping',
      ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), ip],
      (err, stdout) => {
        if (err) return resolve({ ok: false });
        const m = /time[=<]\s*([\d.]+)\s*ms/.exec(stdout);
        resolve({ ok: true, latencyMs: m ? parseFloat(m[1]) : undefined });
      },
    );
  });
}

/** ICMP first (if enabled), then TCP-connect over the port set; reachable if any succeeds. */
export async function probeDevice(
  ip: string,
  opts: { icmpEnabled: boolean; ports: number[]; timeoutMs: number },
): Promise<ProbeResult> {
  if (opts.icmpEnabled) {
    const r = await icmpProbe(ip, opts.timeoutMs);
    if (r.ok) return r;
  }
  if (opts.ports.length === 0) return { ok: false };
  // Race the TCP ports concurrently: resolve on the FIRST successful connect, or once
  // every port has failed. Trying ports serially made a down device pay
  // ports.length × timeoutMs (e.g. 3 × 2s = 6s) while holding a concurrency slot; racing
  // bounds it to ~1 × timeoutMs. tcpProbe never rejects, so we can't use Promise.any
  // (which would resolve on the first *failure*); count failures down instead.
  return new Promise<ProbeResult>((resolve) => {
    let pending = opts.ports.length;
    for (const port of opts.ports) {
      void tcpProbe(ip, port, opts.timeoutMs).then((r) => {
        if (r.ok) resolve(r);
        else if (--pending === 0) resolve({ ok: false });
      });
    }
  });
}
