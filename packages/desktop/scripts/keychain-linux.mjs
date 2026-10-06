// The keychain on Linux with no Secret Service (story 13.15, AD-16): the bundled server starts, and saving
// an API key is refused in plain words (503 `secrets_unavailable`), never stored anywhere else and never
// crashing the server. Run after `stage.mjs`, inside `dbus-run-session` (a session bus with no secret
// service on it, as a headless CI machine and some desktops have).
//
//   node packages/desktop/scripts/keychain-linux.mjs --target <rust triple>
//
// A private data folder; the real keychain module is used (no memory-store hook), so nothing is faked
// but the key itself, which is not a real key and is never sent anywhere (the key check is the test hook).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { target: { type: 'string' } }, strict: true });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sidecar = join(root, 'src-tauri', 'binaries', `ogden-node-${values.target}`);
const pkg = join(root, 'stage', 'app', 'node_modules', 'ogden-agents');
if (!values.target || !existsSync(sidecar)) throw new Error('usage: keychain-linux.mjs --target <triple> (after stage.mjs)');

const work = mkdtempSync(join(tmpdir(), 'ogden-keychain-'));
const env = {
  PATH: process.env.PATH,
  HOME: work,
  DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS ?? '',
  OGDEN_AGENTS_DATA_DIR: join(work, 'data'),
  OGDEN_AGENTS_SHELL: 'desktop',
  OGDEN_AGENTS_OFFLINE: '1',
  // Test hooks that only a test run on a temp folder honours: a key check that accepts without reaching a provider.
  NODE_ENV: 'test',
  OGDEN_AGENTS_TEST_API_KEY_CHECK: 'accept',
};
let launcher;
let failure;
try {
  launcher = spawn(sidecar, [join(pkg, 'bin', 'ogden.js'), '--json', '--no-open', '--port', '0'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  launcher.stdout.on('data', (c) => (out += c));
  const stop = Date.now() + 90_000;
  while (!out.includes('\n')) {
    if (Date.now() > stop || launcher.exitCode !== null) throw new Error('the server did not start');
    await new Promise((r) => setTimeout(r, 200));
  }
  const info = JSON.parse(out.split('\n')[0]);
  const code = new URL(info.launchUrl).hash.replace(/^#c=/, '');
  const ex = await fetch(`${info.url}/api/v1/tab/exchange`, { method: 'POST', headers: { origin: info.url, 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  const headers = { authorization: `Bearer ${(await ex.json()).token}`, origin: info.url, 'content-type': 'application/json' };
  const saved = await fetch(`${info.url}/api/v1/agents/claude-code/api-key`, { method: 'PUT', headers, body: JSON.stringify({ apiKey: `sk-ant-${'x'.repeat(40)}` }) });
  const body = await saved.text();
  console.log(`saving a key with no Secret Service: ${saved.status} ${body.slice(0, 160)}`);
  if (saved.status !== 503 || !body.includes('secrets_unavailable')) throw new Error('expected the plain 503 secrets_unavailable refusal');
  if (/sk-ant-x{10}/.test(body)) throw new Error('the refusal echoed the key');
  const still = await fetch(`${info.url}/api/v1/tab`, { headers });
  if (still.status !== 204) throw new Error('the server stopped answering after the refusal');
  const quit = await fetch(`${info.url}/api/v1/server/quit`, { method: 'POST', headers, body: '{}' });
  if (quit.status !== 202) throw new Error(`quit answered ${quit.status}`);
  console.log('ok: the server refused the key in plain words, kept running, and quit');
} catch (error) {
  failure = error;
  console.error(`KEYCHAIN CHECK FAILED: ${error.message}`);
} finally {
  try {
    launcher?.kill('SIGKILL');
  } catch {
    // Already gone.
  }
  spawnSync('pkill', ['-f', join(work, 'data')]);
  rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
process.exit(failure ? 1 : 0);
