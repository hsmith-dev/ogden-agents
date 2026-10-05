// SPIKE 16.1 (TEMPORARY): a stand-in for the Ogden server process: it opens panes with node-pty and prints their pids.
// The probe kills this process hard and then looks at what the panes' programs did.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../../packages/adapters/package.json'));
const nodePty = require('node-pty');
const fake = join(here, 'fake-cli.mjs');
const env = { PATH: process.env.PATH ?? '', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', ComSpec: process.env.ComSpec ?? '' } : { HOME: process.env.HOME ?? '' }) };
const modes = process.argv.slice(2);
const pids = {};
for (const mode of modes) {
  const term = nodePty.spawn(process.execPath, [fake, mode], { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(), env });
  term.onData(() => {});
  pids[mode] = term.pid;
}
process.stdout.write(`PIDS ${JSON.stringify(pids)}\n`);
setInterval(() => {}, 1000);
