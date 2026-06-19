import { hostname, platform } from 'node:os';
import { createRequire } from 'node:module';
import { enroll } from './enroll.js';
import { saveCredentials, loadCredentials } from './credentials.js';
import { loadConfig } from './config.js';
import { createAgentClient } from './api-client.js';
import { createBuffer } from './buffer.js';
import { probeFromConfig } from './poller.js';
import { runCycle } from './runtime.js';

// Injected by esbuild at bundle time via --define:__AGENT_VERSION__='"x.y.z"'.
// In non-bundled (dev/test) mode this declaration resolves to undefined at runtime.
declare const __AGENT_VERSION__: string | undefined;

// Resolve version from (in priority order):
// 1. Compile-time constant injected by esbuild (works inside SEA binary where package.json is absent)
// 2. package.json loaded at runtime via createRequire (works in dev / non-bundled ESM)
// 3. Hardcoded fallback '0.0.0'
function getVersion(): string {
  try {
    if (typeof __AGENT_VERSION__ !== 'undefined' && __AGENT_VERSION__) return __AGENT_VERSION__;
  } catch { /* not bundled */ }
  try {
    // In a bundled CJS output, createRequire works and resolves relative to __dirname.
    const req = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pkg = req('../package.json') as { version: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const AGENT_VERSION: string = getVersion();

export interface ParsedArgs {
  command: 'version' | 'enroll' | 'run';
  options: { code?: string; url?: string };
}

export function parseArgs(argv: string[]): ParsedArgs {
  // argv is process.argv.slice(2) — the raw args after the binary name.
  const args = [...argv];

  // --version / -v
  if (args.includes('--version') || args.includes('-v')) {
    return { command: 'version', options: {} };
  }

  // enroll subcommand
  if (args[0] === 'enroll') {
    const opts: { code?: string; url?: string } = {};
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--code' && args[i + 1]) { opts.code = args[++i]; }
      else if (args[i] === '--url' && args[i + 1]) { opts.url = args[++i]; }
    }
    return { command: 'enroll', options: opts };
  }

  // Default: run daemon
  return { command: 'run', options: {} };
}

export interface CliDeps {
  enroll?: typeof enroll;
  saveCredentials?: typeof saveCredentials;
  startDaemon?: () => Promise<void>;
  exit?: (code: number) => never;
  log?: (msg: string) => void;
}

export async function runCli(argv: string[], deps?: CliDeps): Promise<void> {
  const parsed = parseArgs(argv);

  const exitFn = deps?.exit ?? ((code) => process.exit(code) as never);
  const logFn = deps?.log ?? ((msg: string) => console.log(msg));

  if (parsed.command === 'version') {
    logFn(AGENT_VERSION);
    exitFn(0);
    return;
  }

  if (parsed.command === 'enroll') {
    const { code, url } = parsed.options;
    if (!code) { logFn('enroll requires --code'); exitFn(1); return; }

    const cfg = loadConfig(url ? { env: { ...process.env, NODESCOPE_AGENT_API_URL: url } } : undefined);
    const credPath = process.env.NODESCOPE_AGENT_CREDENTIALS ?? '/etc/nodescope-agent/credentials.json';

    const enrollFn = deps?.enroll ?? enroll;
    const saveFn = deps?.saveCredentials ?? saveCredentials;

    const creds = await enrollFn({
      apiUrl: url ?? cfg.apiUrl,
      code,
      name: hostname(),
      platform: platform(),
      version: AGENT_VERSION,
    });
    saveFn(credPath, creds);
    logFn(`Enrolled. Agent ID: ${creds.agentId}`);
    exitFn(0);
    return;
  }

  // command === 'run'
  if (deps?.startDaemon) {
    await deps.startDaemon();
  } else {
    await runDaemon();
  }
}

async function runDaemon(): Promise<void> {
  const cfg = loadConfig();
  const credPath = process.env.NODESCOPE_AGENT_CREDENTIALS ?? '/etc/nodescope-agent/credentials.json';
  let creds = loadCredentials(credPath);
  if (!creds && process.env.NODESCOPE_AGENT_ENROLL_CODE) {
    creds = await enroll({ apiUrl: cfg.apiUrl, code: process.env.NODESCOPE_AGENT_ENROLL_CODE, name: hostname(), platform: platform(), version: AGENT_VERSION });
    saveCredentials(credPath, creds);
  }
  if (!creds) throw new Error('Not enrolled: provide NODESCOPE_AGENT_ENROLL_CODE or run `nodescope-agent enroll`');
  const client = createAgentClient({ apiUrl: cfg.apiUrl, token: creds.token });
  const buffer = createBuffer({ path: process.env.NODESCOPE_AGENT_QUEUE ?? '/var/lib/nodescope-agent/queue.jsonl', maxItems: 5000 });
  const probe = probeFromConfig(cfg);
  const tick = () => runCycle({ client, buffer, probe, concurrency: cfg.concurrency }).catch((e) => console.error('[agent] cycle error', e));
  const interval = setInterval(tick, cfg.probeIntervalMs);
  void tick();
  const shutdown = async () => {
    clearInterval(interval);
    try { await buffer.drain(client.ingest); } catch { /* best-effort */ }
    process.exit(0);
  };
  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
}
