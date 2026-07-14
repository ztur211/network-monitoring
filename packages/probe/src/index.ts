import { createConnection } from 'node:net';
import { execFile as nodeExecFile } from 'node:child_process';

type ExecFileFn = typeof nodeExecFile;

export interface ProbeResult {
  ok: boolean;
  latencyMs?: number;
  /** ICMP could not even be attempted (no `ping` binary). Distinct from "host did not reply". */
  icmpUnavailable?: boolean;
}

/**
 * Latched once ICMP is proven impossible on this host, so we stop spawning a child process per
 * device per cycle that can only ever fail. Process-local: a probe worker is one process, and a
 * missing binary does not come back mid-run.
 */
let icmpUnavailable = false;

/** Reports the misconfiguration once. Overridable so a host app can route it to its logger. */
let onIcmpUnavailable: (message: string) => void = (message) => console.error(`[probe] ${message}`);

export function setIcmpUnavailableHandler(handler: (message: string) => void): void {
  onIcmpUnavailable = handler;
}

/** Test seam: forget that ICMP was found unavailable. */
export function resetIcmpAvailability(): void {
  icmpUnavailable = false;
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
 *
 * `-W` bounds a single *reply*, not a stalled child: a hung resolver, a zombied ping, or
 * BSD/macOS (where `-W` is *milliseconds*, so `-W 2` ≈ 2 ms and the process outlives the
 * budget) would leave the callback un-fired and this promise — and the probe's concurrency
 * slot — hung forever. So also give execFile a hard `timeout` (+ SIGKILL) as a backstop;
 * on timeout it kills the child and invokes the callback with an error → we resolve unreachable.
 */
export function icmpProbe(ip: string, timeoutMs: number, exec: ExecFileFn = nodeExecFile): Promise<ProbeResult> {
  return new Promise((resolve) => {
    if (icmpUnavailable) return resolve({ ok: false, icmpUnavailable: true });
    const pingSecs = Math.max(1, Math.ceil(timeoutMs / 1000));
    let settled = false;
    const done = (r: ProbeResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    exec(
      'ping',
      ['-c', '1', '-W', String(pingSecs), ip],
      { timeout: pingSecs * 1000 + 1000, killSignal: 'SIGKILL' },
      (err, stdout) => {
        if (err) {
          // ENOENT = there is no `ping` binary on this host. That is a broken deployment,
          // NOT a dead device, and conflating the two is how a monitoring product invents
          // outages: every ICMP-only device (printers, cameras, switches with no open
          // 443/80/22) gets reported DOWN. Latch it, say so once, and stop paying for a
          // child process per device per cycle that can only ever fail.
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            if (!icmpUnavailable) {
              icmpUnavailable = true;
              onIcmpUnavailable(
                'ICMP probing is DISABLED: no `ping` binary on this host (install iputils-ping, ' +
                  'or set MONITORING_ICMP_ENABLED=false to silence this). Probes now fall back to ' +
                  'TCP only, so a device that answers ping but exposes no probed port reads as DOWN.',
              );
            }
            return done({ ok: false, icmpUnavailable: true });
          }
          return done({ ok: false });
        }
        const m = /time[=<]\s*([\d.]+)\s*ms/.exec(stdout);
        done({ ok: true, latencyMs: m ? parseFloat(m[1]) : undefined });
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
