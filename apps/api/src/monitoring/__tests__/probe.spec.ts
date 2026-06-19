import { createServer, Server } from 'node:net';
import { tcpProbe, probeDevice } from '../prober/probe';

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
});
