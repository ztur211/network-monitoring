import { loadConfig } from './config.js';
import { loadCredentials, saveCredentials } from './credentials.js';
import { enroll } from './enroll.js';
import { createAgentClient } from './api-client.js';
import { createBuffer } from './buffer.js';
import { probeFromConfig } from './poller.js';
import { runCycle } from './runtime.js';
import { platform, hostname } from 'node:os';

async function main() {
  const cfg = loadConfig();
  const credPath = process.env.NODESCOPE_AGENT_CREDENTIALS ?? '/etc/nodescope-agent/credentials.json';
  let creds = loadCredentials(credPath);
  if (!creds && process.env.NODESCOPE_AGENT_ENROLL_CODE) {
    creds = await enroll({ apiUrl: cfg.apiUrl, code: process.env.NODESCOPE_AGENT_ENROLL_CODE, name: hostname(), platform: platform(), version: process.env.npm_package_version ?? '0.0.0' });
    saveCredentials(credPath, creds);
  }
  if (!creds) throw new Error('Not enrolled: provide NODESCOPE_AGENT_ENROLL_CODE or run `nodescope-agent enroll`');
  const client = createAgentClient({ apiUrl: cfg.apiUrl, token: creds.token });
  const buffer = createBuffer({ path: process.env.NODESCOPE_AGENT_QUEUE ?? '/var/lib/nodescope-agent/queue.jsonl', maxItems: 5000 });
  const probe = probeFromConfig(cfg);
  const tick = () => runCycle({ client, buffer, probe, concurrency: cfg.concurrency }).catch((e) => console.error('[agent] cycle error', e));
  setInterval(tick, cfg.probeIntervalMs); void tick();
}
main().catch((e) => {
  console.error('[agent] fatal', e);
  process.exit(1);
});
