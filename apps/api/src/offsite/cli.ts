import { generateKeypair } from './crypto';
import { offsiteConfigFromEnv } from './config';
import { s3StoreFromConfig } from './object-store';
import { pushBundle, pullBundle, listBackups } from './backup';

function err(msg: string): number { process.stderr.write(`[offsite] ${msg}\n`); return 1; }

export async function runCli(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === 'keygen') {
    const { publicKey, privateKey } = await generateKeypair();
    process.stdout.write(`PUBKEY=${publicKey}\nPRIVKEY=${privateKey}\n`);
    return 0;
  }

  // Validate the subcommand BEFORE requiring config, so a typo on a fresh (unconfigured)
  // install reports the real problem instead of "off-site not configured".
  if (cmd !== 'push' && cmd !== 'pull' && cmd !== 'list') {
    return err(`unknown command: ${cmd ?? '(none)'} (keygen|push|pull|list)`);
  }

  const cfg = offsiteConfigFromEnv();
  if (!cfg) return err('off-site not configured (set OFFSITE_BACKUP_PUBKEY + OFFSITE_S3_BUCKET + creds)');
  const store = s3StoreFromConfig(cfg);

  try {
    if (cmd === 'push') {
      const dir = rest[0];
      if (!dir) return err('usage: push <bundle-dir>');
      const key = await pushBundle(store, cfg, dir);
      process.stdout.write(`${key}\n`);
      return 0;
    }
    if (cmd === 'pull') {
      const [name, dest] = rest;
      if (!name || !dest) return err('usage: pull <name> <dest-dir>');
      const priv = process.env.OFFSITE_IDENTITY ?? '';
      if (!priv) return err('OFFSITE_IDENTITY (base64 private key) is required to decrypt');
      await pullBundle(store, cfg, name, dest, priv);
      process.stderr.write(`[offsite] restored ${name} -> ${dest}\n`);
      return 0;
    }
    for (const n of await listBackups(store, cfg)) process.stdout.write(`${n}\n`);
    return 0;
  } catch (e) {
    return err((e as Error)?.message ?? String(e));
  }
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && /offsite[\\/]cli(\.[cm]?js|\.ts)?$/.test(process.argv[1])) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stderr.write(`[offsite] ${e?.message ?? e}\n`); process.exit(1); });
}
