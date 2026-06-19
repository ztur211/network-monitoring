import { runCli } from './cli.js';

runCli(process.argv.slice(2)).catch((e) => {
  console.error('[agent] fatal', e);
  process.exit(1);
});
